import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from '../db/pool.js';
import { sesiones, usuarios } from '../db/schema.js';
import { DrizzleUsuariosRepo } from '../usuarios/repository.js';
import { DrizzleSesionesRepo } from './repository.js';

// Real Docker Postgres suite (see vitest.integration.config.ts). Verifies
// the migrated schema (tables, FK, rol_usuario enum) and the atomic lockout
// UPDATE's Postgres-specific CASE-branch evaluation order, which cannot be
// exercised meaningfully against a fake pool.
const db = getDb();
const usuariosRepo = new DrizzleUsuariosRepo(db);
const sesionesRepo = new DrizzleSesionesRepo(db);

async function insertUsuario() {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre: 'Test User',
      email: `test-${randomUUID()}@example.com`,
      hashContrasena: 'irrelevant-hash',
      rol: 'encargado',
    })
    .returning();
  if (!row) {
    throw new Error('insertUsuario: expected exactly one row back');
  }
  return row;
}

describe('auth repository (integration, real Postgres)', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table sesiones, usuarios cascade`);
  });

  afterAll(async () => {
    await getPool().end();
  });

  it('migration applies: usuarios/sesiones tables exist with the rol_usuario enum and the sesiones->usuarios FK', async () => {
    const usuario = await insertUsuario();
    expect(usuario.rol).toBe('encargado');

    await expect(
      db.insert(sesiones).values({
        id: randomUUID(),
        usuarioId: randomUUID(),
        expiraEn: new Date(Date.now() + 1000),
      }),
    ).rejects.toThrow();
  });

  it('migration applies: debe_cambiar_password exists and defaults to false for a fresh row', async () => {
    const usuario = await insertUsuario();

    expect(usuario.debeCambiarPassword).toBe(false);
  });

  it('updatePassword sets the hash and clears debe_cambiar_password together', async () => {
    const usuario = await insertUsuario();
    await db
      .update(usuarios)
      .set({ debeCambiarPassword: true })
      .where(eq(usuarios.id, usuario.id));

    await usuariosRepo.updatePassword(usuario.id, 'new-hash-value');

    const [row] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, usuario.id));
    expect(row?.hashContrasena).toBe('new-hash-value');
    expect(row?.debeCambiarPassword).toBe(false);
  });

  it('deleteOthers removes only the other sessions and the current cookie session still resolves via findValid', async () => {
    const usuario = await insertUsuario();
    await sesionesRepo.create({
      id: 'session-a',
      usuarioId: usuario.id,
      expiraEn: new Date(Date.now() + 100_000),
    });
    await sesionesRepo.create({
      id: 'session-b',
      usuarioId: usuario.id,
      expiraEn: new Date(Date.now() + 100_000),
    });

    await sesionesRepo.deleteOthers(usuario.id, 'session-a');

    const stillValid = await sesionesRepo.findValid('session-a', new Date());
    expect(stillValid?.id).toBe(usuario.id);

    const revoked = await sesionesRepo.findValid('session-b', new Date());
    expect(revoked).toBeUndefined();
  });

  it('registerFailedAttempt increments the counter below the lockout threshold', async () => {
    const usuario = await insertUsuario();

    const first = await usuariosRepo.registerFailedAttempt(usuario.id);
    expect(first.intentosFallidos).toBe(1);
    expect(first.bloqueadoHasta).toBeNull();

    const second = await usuariosRepo.registerFailedAttempt(usuario.id);
    expect(second.intentosFallidos).toBe(2);
    expect(second.bloqueadoHasta).toBeNull();
  });

  it('registerFailedAttempt locks the account on the 5th failure', async () => {
    const usuario = await insertUsuario();

    let result = await usuariosRepo.registerFailedAttempt(usuario.id);
    for (let i = 1; i < 5; i += 1) {
      result = await usuariosRepo.registerFailedAttempt(usuario.id);
    }

    expect(result.intentosFallidos).toBe(5);
    if (result.bloqueadoHasta === null) {
      throw new Error(
        'expected bloqueadoHasta to be set after the 5th failure',
      );
    }
    expect(result.bloqueadoHasta.getTime()).toBeGreaterThan(Date.now());
  });

  it('registerFailedAttempt resets a stale counter to 1 once the lockout window has elapsed', async () => {
    const usuario = await insertUsuario();
    // Simulate a lockout whose window already elapsed (stale counter of 5).
    await db
      .update(usuarios)
      .set({
        intentosFallidos: 5,
        bloqueadoHasta: new Date(Date.now() - 1000),
      })
      .where(eq(usuarios.id, usuario.id));

    const result = await usuariosRepo.registerFailedAttempt(usuario.id);

    expect(result.intentosFallidos).toBe(1);
    expect(result.bloqueadoHasta).toBeNull();
  });

  it('purgeExpired deletes only expired sessions scoped to the given user', async () => {
    const usuario = await insertUsuario();
    const otro = await insertUsuario();
    await sesionesRepo.create({
      id: 'expired-own',
      usuarioId: usuario.id,
      expiraEn: new Date(Date.now() - 1000),
    });
    await sesionesRepo.create({
      id: 'valid-own',
      usuarioId: usuario.id,
      expiraEn: new Date(Date.now() + 100_000),
    });
    await sesionesRepo.create({
      id: 'expired-other',
      usuarioId: otro.id,
      expiraEn: new Date(Date.now() - 1000),
    });

    await sesionesRepo.purgeExpired(usuario.id);

    const remaining = await db.select({ id: sesiones.id }).from(sesiones);
    expect(remaining.map((row) => row.id).sort()).toEqual([
      'expired-other',
      'valid-own',
    ]);
  });
});
