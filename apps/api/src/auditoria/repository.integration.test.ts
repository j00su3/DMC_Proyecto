import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from '../db/pool.js';
import { auditoria, usuarios } from '../db/schema.js';
import { DrizzleAuditoriaRepo } from './repository.js';

// Real Docker Postgres. Proves the migration (task 2.2/2.3) landed exactly
// as designed: both indexes exist, the D7 CHECK is enforced, all three D9
// enum values are accepted, and the D14 actor FK rejects an unknown user.
const db = getDb();
const repo = new DrizzleAuditoriaRepo(db);

async function insertUsuario() {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre: 'Audit Test Actor',
      email: `audit-${randomUUID()}@example.com`,
      hashContrasena: 'irrelevant-for-this-test',
      rol: 'deposito',
    })
    .returning();
  if (!row) {
    throw new Error('insertUsuario: expected exactly one row back');
  }
  return row;
}

describe('DrizzleAuditoriaRepo (integration, real Postgres)', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table auditoria, sesiones, usuarios cascade`);
  });

  afterAll(async () => {
    await getPool().end();
  });

  it('the migration created both composite indexes on auditoria', async () => {
    const result = await db.execute(
      sql`select indexname from pg_indexes where tablename = 'auditoria'`,
    );
    const indexNames = (
      result as unknown as { rows: { indexname: string }[] }
    ).rows.map((row) => row.indexname);

    expect(indexNames).toContain('auditoria_entidad_entidad_id_creado_en_idx');
    expect(indexNames).toContain('auditoria_usuario_id_creado_en_idx');
  });

  it('the CHECK rejects accion=crear with a non-null datosPrevios (D7)', async () => {
    const actor = await insertUsuario();

    let caught: unknown;
    try {
      await repo.record({
        entidad: 'usuarios',
        entidadId: randomUUID(),
        accion: 'crear',
        usuarioId: actor.id,
        datosPrevios: { nombre: 'should not be allowed on crear' },
        datosPosteriores: { nombre: 'New User' },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { message?: string } }).cause;
    expect(cause?.message).toMatch(/auditoria_datos_previos_solo_en_crear/);
  });

  it('accion=crear with datosPrevios null is accepted by the CHECK (D7)', async () => {
    const actor = await insertUsuario();

    await expect(
      repo.record({
        entidad: 'usuarios',
        entidadId: randomUUID(),
        accion: 'crear',
        usuarioId: actor.id,
        datosPrevios: null,
        datosPosteriores: { nombre: 'New User' },
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts all three entidad enum values at the database level (D9)', async () => {
    const actor = await insertUsuario();

    // The service surface only classifies 'usuarios' in this change (D9),
    // so this bypasses the repo/service typing and inserts directly through
    // the schema object — proving the pgEnum and the FK-less entidad_id
    // column already accept 'proveedores' and 'productos' rows even though
    // no call site can produce them yet.
    for (const entidad of ['usuarios', 'proveedores', 'productos'] as const) {
      await expect(
        db.insert(auditoria).values({
          entidad,
          entidadId: randomUUID(),
          accion: 'actualizar',
          usuarioId: actor.id,
          datosPrevios: { campo: 'antes' },
          datosPosteriores: { campo: 'despues' },
        }),
      ).resolves.toBeDefined();
    }
  });

  it('the usuario_id FK rejects an unknown actor (D14)', async () => {
    await expect(
      repo.record({
        entidad: 'usuarios',
        entidadId: randomUUID(),
        accion: 'actualizar',
        usuarioId: randomUUID(), // no such usuarios row
        datosPrevios: { campo: 'antes' },
        datosPosteriores: { campo: 'despues' },
      }),
    ).rejects.toThrow();
  });
});
