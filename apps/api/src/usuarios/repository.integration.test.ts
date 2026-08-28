import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from '../db/pool.js';
import { usuarios } from '../db/schema.js';
import { DrizzleUsuariosRepo } from './repository.js';

// Real Docker Postgres suite (see vitest.integration.config.ts). Proves
// properties that are properties of SQL, not of the fake pool: the explicit
// no-hash projection (D15), the creado_en/id tiebreaker order (D17), the
// 23505 -> EMAIL_ALREADY_IN_USE mapping (D9), and resetPassword's
// single-statement lockout clear (D11).
const db = getDb();
const repo = new DrizzleUsuariosRepo(db);

async function insertUsuario(
  overrides: Partial<{
    id: string;
    nombre: string;
    email: string;
    rol: 'encargado' | 'deposito';
    creadoEn: Date;
  }> = {},
) {
  const [row] = await db
    .insert(usuarios)
    .values({
      ...(overrides.id ? { id: overrides.id } : {}),
      nombre: overrides.nombre ?? 'Test User',
      email: overrides.email ?? `test-${randomUUID()}@example.com`,
      hashContrasena: 'irrelevant-hash',
      rol: overrides.rol ?? 'encargado',
      ...(overrides.creadoEn ? { creadoEn: overrides.creadoEn } : {}),
    })
    .returning();
  if (!row) {
    throw new Error('insertUsuario: expected exactly one row back');
  }
  return row;
}

describe('usuarios repository (integration, real Postgres)', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table sesiones, usuarios cascade`);
  });

  afterAll(async () => {
    await getPool().end();
  });

  describe('D15 — no-hash projection', () => {
    it('list rows carry no hashContrasena key', async () => {
      await insertUsuario();

      const { rows } = await repo.list(1, 20);

      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0] as object)).not.toContain('hashContrasena');
    });

    it('findById row carries no hashContrasena key', async () => {
      const usuario = await insertUsuario();

      const row = await repo.findById(usuario.id);

      expect(row).toBeDefined();
      expect(Object.keys(row as object)).not.toContain('hashContrasena');
    });

    it('findByIdForUpdate row carries no hashContrasena key', async () => {
      const usuario = await insertUsuario();

      const row = await repo.findByIdForUpdate(usuario.id);

      expect(row).toBeDefined();
      expect(Object.keys(row as object)).not.toContain('hashContrasena');
    });
  });

  describe('D17 — pagination order and total', () => {
    it('breaks creado_en ties by id desc, not by physical row order', async () => {
      const tiedCreadoEn = new Date('2026-01-01T00:00:00.000Z');
      // The ids are explicit and INSERTED IN ASCENDING ORDER on purpose.
      // A seq scan over five rows returns them in insertion order, so with
      // the `id desc` tiebreaker dropped the query still answers — just
      // ascending. Random ids would leave insertion order and id order
      // agreeing by chance about 1 run in 120, which is a flaky test, not a
      // guard. Fixing them makes the two orders disagree every run.
      const ascendingIds = [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555',
      ];
      for (const id of ascendingIds) {
        await insertUsuario({ id, creadoEn: tiedCreadoEn });
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
      // The exact sequence, not just the set. Asserting only "no overlap and
      // no gap" passes with no tiebreaker at all, because a small seq scan
      // is incidentally stable across the three OFFSET queries — the set is
      // identical either way and the ORDER is the only thing the tiebreaker
      // controls.
      expect(seenIds).toEqual([...ascendingIds].reverse());
    });

    it('orders newest creado_en first when there is no tie', async () => {
      const older = await insertUsuario({
        creadoEn: new Date('2020-01-01T00:00:00.000Z'),
      });
      const newer = await insertUsuario({
        creadoEn: new Date('2025-01-01T00:00:00.000Z'),
      });

      const { rows } = await repo.list(1, 20);

      expect(rows.map((r) => r.id)).toEqual([newer.id, older.id]);
    });
  });

  describe('D9 — duplicate email mapping', () => {
    it('create surfaces EMAIL_ALREADY_IN_USE, not a raw pg error', async () => {
      const email = `dup-${randomUUID()}@example.com`;
      await insertUsuario({ email });

      await expect(
        repo.create({
          nombre: 'Second User',
          email,
          rol: 'deposito',
          hashContrasena: 'irrelevant-hash',
        }),
      ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_IN_USE' });
    });

    it('create normalizes email with trim/lowercase, colliding with an existing normalized email', async () => {
      const email = `norm-${randomUUID()}@example.com`;
      await insertUsuario({ email });

      await expect(
        repo.create({
          nombre: 'Second User',
          email: `  ${email.toUpperCase()}  `,
          rol: 'deposito',
          hashContrasena: 'irrelevant-hash',
        }),
      ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_IN_USE' });
    });

    it('update surfaces EMAIL_ALREADY_IN_USE, not a raw pg error', async () => {
      const email = `dup-${randomUUID()}@example.com`;
      await insertUsuario({ email });
      const target = await insertUsuario();

      await expect(repo.update(target.id, { email })).rejects.toMatchObject({
        code: 'EMAIL_ALREADY_IN_USE',
      });
    });
  });

  describe('D11 — resetPassword clears lockout in the same statement', () => {
    it('sets debeCambiarPassword and clears intentosFallidos/bloqueadoHasta', async () => {
      const usuario = await insertUsuario();
      await db
        .update(usuarios)
        .set({
          intentosFallidos: 5,
          bloqueadoHasta: new Date(Date.now() + 100_000),
        })
        .where(sql`${usuarios.id} = ${usuario.id}`);

      const result = await repo.resetPassword(usuario.id, 'new-hash-value');

      expect(result.debeCambiarPassword).toBe(true);

      const [row] = await db
        .select()
        .from(usuarios)
        .where(sql`${usuarios.id} = ${usuario.id}`);
      expect(row?.hashContrasena).toBe('new-hash-value');
      expect(row?.intentosFallidos).toBe(0);
      expect(row?.bloqueadoHasta).toBeNull();
    });
  });

  describe('D11 — setActivo leaves lockout counters untouched', () => {
    it('reactivate does not reset intentosFallidos or bloqueadoHasta', async () => {
      const usuario = await insertUsuario();
      const lockUntil = new Date(Date.now() + 100_000);
      await db
        .update(usuarios)
        .set({ activo: false, intentosFallidos: 3, bloqueadoHasta: lockUntil })
        .where(sql`${usuarios.id} = ${usuario.id}`);

      const result = await repo.setActivo(usuario.id, true);

      expect(result.activo).toBe(true);

      const [row] = await db
        .select()
        .from(usuarios)
        .where(sql`${usuarios.id} = ${usuario.id}`);
      expect(row?.intentosFallidos).toBe(3);
      expect(row?.bloqueadoHasta?.getTime()).toBe(lockUntil.getTime());
    });
  });
});
