import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from '../db/pool.js';
import { usuarios } from '../db/schema.js';
import { createUnitOfWork } from '../db/uow.js';
import { lastActiveEncargado } from '../lib/errors.js';

// Real Docker Postgres, TWO real transactions on separate pooled
// connections. This is the one property in the change no unit test can
// substitute for: the last-active-encargado invariant spans rows, and write
// skew is invisible to any single-connection test because it needs two
// snapshots that cannot see each other's uncommitted writes (design.md D2).
//
// The suite also carries the documented negative — the rejected
// EXISTS-subquery UPDATE, run in this same harness, leaving zero active
// encargados. Same shape as uow.integration.test.ts's negative for
// auditoria-general D1: a rejected alternative is rejected on evidence.
const db = getDb();
const uow = createUnitOfWork(db);

const DEACTIVATE_WITH_EXISTS_GUARD =
  'update usuarios set activo = false ' +
  'where id = $1 and activo = true and exists (' +
  "  select 1 from usuarios u2 where u2.id <> $1 and u2.rol = 'encargado' and u2.activo = true" +
  ')';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Waits until Postgres reports an ungranted lock request, i.e. some backend
// is genuinely blocked. Polling the real lock table is what makes the
// interleaving deterministic — a sleep would only make it likely, and a
// test that proves the race is closed must not itself depend on timing.
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

async function insertUsuario(
  nombre: string,
  rol: 'encargado' | 'deposito' = 'encargado',
) {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre,
      email: `guard-${randomUUID()}@example.com`,
      hashContrasena: 'irrelevant-hash',
      rol,
    })
    .returning();
  if (!row) {
    throw new Error('insertUsuario: expected exactly one row back');
  }
  return row;
}

async function insertEncargado(nombre: string) {
  return insertUsuario(nombre, 'encargado');
}

async function countActiveEncargados(): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::int as total from usuarios where rol = 'encargado' and activo = true`,
  );
  const rows = (result as unknown as { rows: { total: number }[] }).rows;
  return rows[0]?.total ?? 0;
}

describe('last-active-encargado guard (integration, two concurrent transactions)', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table sesiones, usuarios cascade`);
  });

  afterAll(async () => {
    await getPool().end();
  });

  // Active `deposito` users must not pad the locked set. If they do, the
  // guard fails OPEN: `locked` minus the target is non-empty, nothing
  // throws, and the last encargado is deactivated. Every other test here
  // has an all-encargado fixture, so dropping `rol = 'encargado'` from the
  // lock predicate is invisible to them — this is the case that sees it.
  it('trips for the last encargado even when active deposito users exist', async () => {
    const soloEncargado = await insertEncargado('Unico Encargado');
    await insertUsuario('Deposito Uno', 'deposito');
    await insertUsuario('Deposito Dos', 'deposito');

    await expect(
      uow.run(async (repos) => {
        const locked = await repos.usuarios.lockActiveEncargados();
        if (locked.filter((id) => id !== soloEncargado.id).length === 0) {
          throw lastActiveEncargado();
        }
        await repos.usuarios.setActivo(soloEncargado.id, false);
      }),
    ).rejects.toMatchObject({ code: 'LAST_ACTIVE_ENCARGADO' });

    expect(await countActiveEncargados()).toBe(1);
  });

  // The mirror of the above: an inactive encargado must not pad the set
  // either. Dropping `activo = true` makes a deactivated encargado count as
  // cover for deactivating the last live one.
  it('trips for the last ACTIVE encargado even when an inactive encargado exists', async () => {
    const vivo = await insertEncargado('Encargado Vivo');
    const dadoDeBaja = await insertEncargado('Encargado Dado De Baja');
    await db
      .update(usuarios)
      .set({ activo: false })
      .where(sql`${usuarios.id} = ${dadoDeBaja.id}`);

    await expect(
      uow.run(async (repos) => {
        const locked = await repos.usuarios.lockActiveEncargados();
        if (locked.filter((id) => id !== vivo.id).length === 0) {
          throw lastActiveEncargado();
        }
        await repos.usuarios.setActivo(vivo.id, false);
      }),
    ).rejects.toMatchObject({ code: 'LAST_ACTIVE_ENCARGADO' });

    expect(await countActiveEncargados()).toBe(1);
  });

  it('two simultaneous deactivates leave exactly one active encargado', async () => {
    const a = await insertEncargado('Encargado A');
    const b = await insertEncargado('Encargado B');
    const firstHoldsLock = deferred();
    const secondIsBlocked = deferred();

    // T1 takes the set lock first, then waits until T2 is provably blocked
    // on it before writing. Without that wait the two could serialise by
    // accident, and a test that passes by accident proves nothing.
    const first = uow.run(async (repos) => {
      const locked = await repos.usuarios.lockActiveEncargados();
      firstHoldsLock.resolve();
      await secondIsBlocked.promise;
      if (locked.filter((id) => id !== a.id).length === 0) {
        throw lastActiveEncargado();
      }
      await repos.usuarios.setActivo(a.id, false);
      return 'first-succeeded';
    });

    const second = (async () => {
      await firstHoldsLock.promise;
      const run = uow.run(async (repos) => {
        // Blocks here until T1 commits, then Postgres re-evaluates the
        // predicate against the NEW row versions — which is the entire
        // reason FOR UPDATE closes this and a WHERE-clause EXISTS cannot.
        const locked = await repos.usuarios.lockActiveEncargados();
        if (locked.filter((id) => id !== b.id).length === 0) {
          throw lastActiveEncargado();
        }
        await repos.usuarios.setActivo(b.id, false);
        return 'second-succeeded';
      });
      await waitForBlockedLock();
      secondIsBlocked.resolve();
      return run;
    })();

    await expect(first).resolves.toBe('first-succeeded');
    await expect(second).rejects.toMatchObject({
      code: 'LAST_ACTIVE_ENCARGADO',
    });
    expect(await countActiveEncargados()).toBe(1);
  });

  it('a deactivate racing a demote leaves exactly one active encargado', async () => {
    const a = await insertEncargado('Encargado A');
    const b = await insertEncargado('Encargado B');
    const firstHoldsLock = deferred();
    const secondIsBlocked = deferred();

    const first = uow.run(async (repos) => {
      const locked = await repos.usuarios.lockActiveEncargados();
      firstHoldsLock.resolve();
      await secondIsBlocked.promise;
      if (locked.filter((id) => id !== a.id).length === 0) {
        throw lastActiveEncargado();
      }
      await repos.usuarios.setActivo(a.id, false);
      return 'deactivate-succeeded';
    });

    const second = (async () => {
      await firstHoldsLock.promise;
      const run = uow.run(async (repos) => {
        const locked = await repos.usuarios.lockActiveEncargados();
        if (locked.filter((id) => id !== b.id).length === 0) {
          throw lastActiveEncargado();
        }
        await repos.usuarios.update(b.id, { rol: 'deposito' });
        return 'demote-succeeded';
      });
      await waitForBlockedLock();
      secondIsBlocked.resolve();
      return run;
    })();

    await expect(first).resolves.toBe('deactivate-succeeded');
    await expect(second).rejects.toMatchObject({
      code: 'LAST_ACTIVE_ENCARGADO',
    });
    expect(await countActiveEncargados()).toBe(1);
  });

  // design.md D2 alternative (a): the single conditional UPDATE, the shape
  // `registerFailedAttempt` uses. That closes a PER-ROW invariant; this one
  // spans rows. Neither statement blocks, because they lock DISJOINT rows —
  // so both evaluate EXISTS against a snapshot in which the other's
  // uncommitted write is invisible, both see a second active encargado, and
  // both commit. This test asserts the damage rather than describing it.
  it('the rejected EXISTS-subquery UPDATE leaves ZERO active encargados (the documented negative)', async () => {
    const a = await insertEncargado('Encargado A');
    const b = await insertEncargado('Encargado B');

    const c1 = await getPool().connect();
    const c2 = await getPool().connect();
    try {
      await c1.query('begin');
      await c2.query('begin');
      await c1.query(DEACTIVATE_WITH_EXISTS_GUARD, [a.id]);
      await c2.query(DEACTIVATE_WITH_EXISTS_GUARD, [b.id]);
      await c1.query('commit');
      await c2.query('commit');
    } finally {
      c1.release();
      c2.release();
    }

    // The bug D2 exists to prevent, observed rather than argued.
    expect(await countActiveEncargados()).toBe(0);
  });
});
