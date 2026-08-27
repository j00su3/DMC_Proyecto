import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleSesionesRepo } from '../auth/repository.js';
import { buildRepos } from '../plugins/repos.js';
import { getDb, getPool } from './pool.js';
import { sesiones, usuarios } from './schema.js';
import { createUnitOfWork } from './uow.js';

// Real Docker Postgres. Proves the D1 guarantee itself: inside `uow.run`,
// the only repos in scope are bound to the transaction, so a write through
// them rolls back together with everything else in the callback — and,
// as the documented negative, a repo NOT obtained from the callback's
// `repos` argument does not get that guarantee for free.
const db = getDb();
const uow = createUnitOfWork(db);

async function insertUsuario() {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre: 'UoW Test User',
      email: `uow-${randomUUID()}@example.com`,
      hashContrasena: 'irrelevant-for-this-test',
      rol: 'deposito',
    })
    .returning();
  if (!row) {
    throw new Error('insertUsuario: expected exactly one row back');
  }
  return row;
}

describe('createUnitOfWork (integration, real Postgres)', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table sesiones, usuarios cascade`);
  });

  afterAll(async () => {
    await getPool().end();
  });

  it('rolls back every write made through the transaction-bound repos when the callback throws', async () => {
    const usuario = await insertUsuario();
    const sesionId = randomUUID();

    await expect(
      uow.run(async (repos) => {
        // First write: succeeds on its own, but must not survive the
        // second write's failure below.
        await repos.sesiones.create({
          id: sesionId,
          usuarioId: usuario.id,
          expiraEn: new Date(Date.now() + 60_000),
        });
        // Second write: throws, forcing ROLLBACK of the whole transaction.
        throw new Error('boom: simulated failure after the first write');
      }),
    ).rejects.toThrow('boom');

    const rows = await db
      .select()
      .from(sesiones)
      .where(eq(sesiones.id, sesionId));
    expect(rows).toHaveLength(0);
  });

  it('does NOT roll back a write made through a repo built from getDb() instead of the callback repos (documented negative)', async () => {
    const usuario = await insertUsuario();
    const outsideSesionId = randomUUID();
    const insideSesionId = randomUUID();

    // This is exactly the mistake D1 makes unreachable by construction:
    // a repo instantiated from the pool-bound `getDb()`, not from the
    // `repos` argument `uow.run` hands to the callback. Using it inside
    // the callback body does NOT put its writes inside the transaction —
    // they commit immediately, on a separate connection, regardless of
    // what the callback does afterward.
    const outsideRepo = new DrizzleSesionesRepo(getDb());

    await expect(
      uow.run(async (repos) => {
        await outsideRepo.create({
          id: outsideSesionId,
          usuarioId: usuario.id,
          expiraEn: new Date(Date.now() + 60_000),
        });
        await repos.sesiones.create({
          id: insideSesionId,
          usuarioId: usuario.id,
          expiraEn: new Date(Date.now() + 60_000),
        });
        throw new Error('boom: simulated failure after both writes');
      }),
    ).rejects.toThrow('boom');

    // The transaction-bound write rolled back, as proven above.
    const insideRows = await db
      .select()
      .from(sesiones)
      .where(eq(sesiones.id, insideSesionId));
    expect(insideRows).toHaveLength(0);

    // The out-of-band write did NOT roll back — it is the silent-bug
    // scenario D1 exists to make unreachable. This assertion documents
    // the negative on purpose: it is expected to find the row.
    const outsideRows = await db
      .select()
      .from(sesiones)
      .where(eq(sesiones.id, outsideSesionId));
    expect(outsideRows).toHaveLength(1);
  });
});
