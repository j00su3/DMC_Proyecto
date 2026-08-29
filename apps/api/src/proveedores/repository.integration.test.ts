import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from '../db/pool.js';
import { proveedores } from '../db/schema.js';
import { DrizzleProveedoresRepo } from './repository.js';

// Real Docker Postgres suite (see vitest.integration.config.ts). Proves
// properties that are properties of SQL, not of the fake pool: the D9
// two-statement pagination (windowed-count trap on an out-of-range page,
// creadoEn/id tiebreaker), the D7 FOR UPDATE lock, the D13 23505 ->
// SUPPLIER_NAME_IN_USE mapping, D8 (setActivo never deletes), and D11
// (update clears contacto to null).
const db = getDb();
const repo = new DrizzleProveedoresRepo(db);

async function insertProveedor(
  overrides: Partial<{
    id: string;
    nombre: string;
    contacto: string | null;
    activo: boolean;
    creadoEn: Date;
  }> = {},
) {
  const [row] = await db
    .insert(proveedores)
    .values({
      ...(overrides.id ? { id: overrides.id } : {}),
      nombre: overrides.nombre ?? `Proveedor ${randomUUID()}`,
      contacto: overrides.contacto ?? null,
      ...(overrides.activo !== undefined ? { activo: overrides.activo } : {}),
      ...(overrides.creadoEn ? { creadoEn: overrides.creadoEn } : {}),
    })
    .returning();
  if (!row) {
    throw new Error('insertProveedor: expected exactly one row back');
  }
  return row;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Waits until Postgres reports an ungranted lock request, i.e. some backend
// is genuinely blocked. Polling the real lock table makes the interleaving
// deterministic — a sleep would only make it likely (mirrors
// usuarios/guard.integration.test.ts's waitForBlockedLock).
async function waitForBlockedLock(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await db.execute(
      sql`select count(*)::int as waiting from pg_locks where not granted`,
    );
    const rows = (result as unknown as { rows: { waiting: number }[] }).rows;
    if ((rows[0]?.waiting ?? 0) > 0) {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    'waitForBlockedLock: no backend ever blocked — the FOR UPDATE lock was never taken',
  );
}

describe('proveedores repository (integration, real Postgres)', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table proveedores cascade`);
  });

  afterAll(async () => {
    await getPool().end();
  });

  describe('D9 — pagination: windowed-count trap and stable tiebreaker', () => {
    it('reports the real total on an out-of-range page instead of 0', async () => {
      await insertProveedor();
      await insertProveedor();

      const result = await repo.list(5, 20);

      expect(result.rows).toHaveLength(0);
      expect(result.total).toBe(2);
    });

    it('breaks creadoEn ties by id desc, not by physical row order', async () => {
      const tiedCreadoEn = new Date('2026-01-01T00:00:00.000Z');
      const ascendingIds = [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555',
      ];
      for (const id of ascendingIds) {
        await insertProveedor({ id, creadoEn: tiedCreadoEn });
      }

      const page1 = await repo.list(1, 2);
      const page2 = await repo.list(2, 2);
      const page3 = await repo.list(3, 2);

      expect(page1.total).toBe(5);
      expect(page2.total).toBe(5);
      expect(page3.total).toBe(5);

      const seenIds = [
        ...page1.rows.map((r) => r.id),
        ...page2.rows.map((r) => r.id),
        ...page3.rows.map((r) => r.id),
      ];
      expect(seenIds).toEqual([...ascendingIds].reverse());
    });
  });

  describe('D7 — findByIdForUpdate holds a real row lock', () => {
    it('returns the row, and a concurrent findByIdForUpdate on the same id blocks until commit', async () => {
      const proveedor = await insertProveedor();
      const firstHoldsLock = deferred();
      const secondIsBlocked = deferred();
      const order: string[] = [];

      // T1 takes the lock first, then waits until T2 is provably blocked on
      // it before committing. Without that wait the two could serialise by
      // accident, and a test that passes by accident proves nothing.
      const first = db.transaction(async (tx) => {
        const tx1Repo = new DrizzleProveedoresRepo(tx);
        const row = await tx1Repo.findByIdForUpdate(proveedor.id);
        expect(row?.id).toBe(proveedor.id);
        firstHoldsLock.resolve();
        await secondIsBlocked.promise;
        order.push('first-tx-committing');
      });

      const second = (async () => {
        await firstHoldsLock.promise;
        const run = db.transaction(async (tx) => {
          // Blocks here until the first transaction commits — the entire
          // point of FOR UPDATE.
          const tx2Repo = new DrizzleProveedoresRepo(tx);
          const row = await tx2Repo.findByIdForUpdate(proveedor.id);
          order.push('second-tx-acquired-lock');
          return row;
        });
        await waitForBlockedLock();
        secondIsBlocked.resolve();
        return run;
      })();

      await first;
      const secondResult = await second;

      expect(secondResult?.id).toBe(proveedor.id);
      expect(order).toEqual(['first-tx-committing', 'second-tx-acquired-lock']);
    });
  });

  describe('D13 — duplicate name mapping', () => {
    it('create surfaces SUPPLIER_NAME_IN_USE, not a raw pg error, case-insensitively', async () => {
      await insertProveedor({ nombre: 'Distribuidora Norte' });

      await expect(
        repo.create({ nombre: 'distribuidora norte' }),
      ).rejects.toMatchObject({ code: 'SUPPLIER_NAME_IN_USE' });
    });

    it('an inactive supplier still blocks the duplicate name', async () => {
      await insertProveedor({ nombre: 'Distribuidora Norte', activo: false });

      await expect(
        repo.create({ nombre: 'DISTRIBUIDORA NORTE' }),
      ).rejects.toMatchObject({ code: 'SUPPLIER_NAME_IN_USE' });
    });

    it('update surfaces SUPPLIER_NAME_IN_USE, not a raw pg error', async () => {
      await insertProveedor({ nombre: 'Distribuidora Norte' });
      const target = await insertProveedor({ nombre: 'Distribuidora Sur' });

      await expect(
        repo.update(target.id, { nombre: 'distribuidora norte' }),
      ).rejects.toMatchObject({ code: 'SUPPLIER_NAME_IN_USE' });
    });

    it('stores the exact casing submitted, never folded', async () => {
      const created = await repo.create({ nombre: 'Distribuidora Norte' });

      expect(created.nombre).toBe('Distribuidora Norte');
      const fetched = await repo.findById(created.id);
      expect(fetched?.nombre).toBe('Distribuidora Norte');
    });
  });

  describe('D8 — setActivo never deletes', () => {
    it('setActivo(false) leaves the row present and readable', async () => {
      const proveedor = await insertProveedor();

      const result = await repo.setActivo(proveedor.id, false);

      expect(result.activo).toBe(false);
      const row = await repo.findById(proveedor.id);
      expect(row).toBeDefined();
      expect(row?.activo).toBe(false);
    });
  });

  describe('D11 — update can clear contacto to null', () => {
    it('update with contacto: null clears an existing value', async () => {
      const proveedor = await insertProveedor({ contacto: '011-4444-5555' });

      const result = await repo.update(proveedor.id, { contacto: null });

      expect(result.contacto).toBeNull();
      const row = await repo.findById(proveedor.id);
      expect(row?.contacto).toBeNull();
    });
  });
});
