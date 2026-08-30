import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from '../db/pool.js';
import { sesiones, usuarios } from '../db/schema.js';
import { DrizzleUsuariosRepo } from '../usuarios/repository.js';
import { DrizzleSesionesRepo } from './repository.js';
import { createToken, hashToken } from './session.js';

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

  // SEC-008. The cookie value used to BE the primary key, so a read of the
  // sesiones table handed over live, usable credentials. Storing sha256(token)
  // keeps the plaintext in the cookie only: the same read now yields hashes,
  // which authenticate nothing. ADR-0007 § Actualizado 2026-08-29 keeps the
  // original justification intact — there is still no second secret to
  // synchronise, because a hash is not a secret.
  it('stores sha256(token) as the primary key, never the cookie value, and still resolves the session', async () => {
    const usuario = await insertUsuario();
    const token = createToken();

    await sesionesRepo.create({
      id: token,
      usuarioId: usuario.id,
      expiraEn: new Date(Date.now() + 60_000),
    });

    const rows = await db.select().from(sesiones);
    expect(rows).toHaveLength(1);
    const stored = rows[0]?.id;
    // The row a database reader would see is NOT the cookie.
    expect(stored).not.toBe(token);
    expect(stored).toBe(hashToken(token));
    expect(stored).toMatch(/^[0-9a-f]{64}$/);

    // And the plaintext cookie still authenticates.
    const resolved = await sesionesRepo.findValid(token, new Date());
    expect(resolved?.id).toBe(usuario.id);

    // A reader who copied the stored value out of the table cannot use it.
    const stolenFromTheTable = await sesionesRepo.findValid(
      stored ?? '',
      new Date(),
    );
    expect(stolenFromTheTable).toBeUndefined();
  });

  it('deletes by the hashed key, so logout with the plaintext cookie removes the row', async () => {
    const usuario = await insertUsuario();
    const token = createToken();
    await sesionesRepo.create({
      id: token,
      usuarioId: usuario.id,
      expiraEn: new Date(Date.now() + 60_000),
    });

    await sesionesRepo.delete(token);

    expect(await db.select().from(sesiones)).toHaveLength(0);
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

    // Rows are keyed by sha256 now (SEC-008), so identify the survivors by
    // the hash of their token rather than by the token itself.
    const remaining = await db.select({ id: sesiones.id }).from(sesiones);
    expect(remaining.map((row) => row.id).sort()).toEqual(
      [hashToken('expired-other'), hashToken('valid-own')].sort(),
    );
  });

  // D10. Unlike deleteOthers, this keeps nothing: on an admin action the
  // actor is a different principal, so there is no caller-owned session on
  // the target worth preserving. Unlike purgeExpired, it does not care
  // whether a session has expired — a live one is exactly what must go.
  it('deleteAllForUser removes every session of the target, expired or not, and none of any other user', async () => {
    const usuario = await insertUsuario();
    const otro = await insertUsuario();
    await sesionesRepo.create({
      id: 'valid-target',
      usuarioId: usuario.id,
      expiraEn: new Date(Date.now() + 100_000),
    });
    await sesionesRepo.create({
      id: 'expired-target',
      usuarioId: usuario.id,
      expiraEn: new Date(Date.now() - 1000),
    });
    await sesionesRepo.create({
      id: 'valid-other',
      usuarioId: otro.id,
      expiraEn: new Date(Date.now() + 100_000),
    });

    await sesionesRepo.deleteAllForUser(usuario.id);

    const remaining = await db.select({ id: sesiones.id }).from(sesiones);
    expect(remaining.map((row) => row.id)).toEqual([hashToken('valid-other')]);
  });

  // D12's reset audit needs the PRIOR lockout values, and UsuarioResumen
  // omits them on purpose (D15) so they never reach a route DTO. This is
  // the narrow read that closes that gap.
  it('findLockoutState returns the live counters and undefined for an unknown id', async () => {
    const usuario = await insertUsuario();
    const bloqueadoHasta = new Date(Date.now() + 100_000);
    await db
      .update(usuarios)
      .set({ intentosFallidos: 4, bloqueadoHasta })
      .where(eq(usuarios.id, usuario.id));

    const estado = await usuariosRepo.findLockoutState(usuario.id);

    expect(estado?.intentosFallidos).toBe(4);
    expect(estado?.bloqueadoHasta?.getTime()).toBe(bloqueadoHasta.getTime());
    await expect(
      usuariosRepo.findLockoutState('00000000-0000-4000-8000-000000000000'),
    ).resolves.toBeUndefined();
  });
});
