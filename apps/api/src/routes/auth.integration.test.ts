import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import { auditoria, usuarios } from '../db/schema.js';
import type { UnitOfWork } from '../db/uow.js';
import { buildRepos } from '../plugins/repos.js';

// Real Docker Postgres + real argon2 + buildApp() with NO stubs (design.md
// Testing Strategy row for routes/auth.integration.test.ts). Covers the
// login -> me -> logout round trip, expired-session -> 401, and lockout
// surviving a rebuilt app instance (cold-start simulation), which is the
// scenario that justifies DB-backed counters over in-memory ones.
const db = getDb();
const COOKIE_SECRET = 'integration-cookie-secret-at-least-32-characters';
const PASSWORD = 'correct-horse-battery-staple';

async function insertUsuario(overrides: Partial<{ activo: boolean }> = {}) {
  const hash = await hashPassword(PASSWORD);
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre: 'Integration User',
      email: `integration-${randomUUID()}@example.com`,
      hashContrasena: hash,
      rol: 'deposito',
      activo: overrides.activo ?? true,
    })
    .returning();
  if (!row) {
    throw new Error('insertUsuario: expected exactly one row back');
  }
  return row;
}

function extractCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) {
    throw new Error('expected a Set-Cookie header');
  }
  const [pair] = raw.split(';');
  return pair ?? '';
}

describe('auth routes (integration, real Postgres, real argon2)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(sql`truncate table sesiones, usuarios cascade`);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await getPool().end();
  });

  it('completes the login -> me -> logout round trip', async () => {
    const usuario = await insertUsuario();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });
    expect(loginResponse.statusCode).toBe(200);
    const cookie = extractCookie(loginResponse.headers['set-cookie']);

    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().usuario.id).toBe(usuario.id);

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logoutResponse.statusCode).toBe(200);

    const meAfterLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(meAfterLogout.statusCode).toBe(401);
  });

  it('treats an expired session as absent (401) regardless of row cleanup', async () => {
    const usuario = await insertUsuario();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });
    const cookie = extractCookie(loginResponse.headers['set-cookie']);

    // Force the session's expira_en into the past directly in the DB —
    // no code path exists to do this through the API (12h fixed TTL).
    await db.execute(
      sql`update sesiones set expira_en = now() - interval '1 minute'`,
    );

    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });

    expect(meResponse.statusCode).toBe(401);
  });

  it('keeps an account locked across a rebuilt app instance (cold-start simulation)', async () => {
    const usuario = await insertUsuario();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });

    for (let i = 0; i < 5; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: usuario.email, password: 'wrong-password' },
      });
      expect([401, 423]).toContain(response.statusCode);
    }

    // Simulate a Render cold start: close this app instance and build a
    // brand-new one. Lockout state must live in Postgres, not memory.
    await app.close();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });

    // SECURITY-REPORT.md S01, owner-ratified 2026-09-01: a wrong password now
    // ALWAYS gets 401, locked or not (that distinction was the enumeration
    // oracle S01 closed), so a wrong password can no longer prove the lock
    // survived the restart. The CORRECT password is the only submission that
    // still tells the two states apart: 423 here (not the 200 a fresh account
    // would give) proves `bloqueadoHasta` was read back from Postgres, not
    // reset by the new process's memory.
    const stillLocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });

    expect(stillLocked.statusCode).toBe(423);
    expect(stillLocked.json().error.code).toBe('ACCOUNT_LOCKED');
  });

  // SEC-001, end to end against real Postgres and real argon2. This is the
  // test docs/BACKLOG.md row 2.3 names: "tras cinco fallos, el titular con la
  // contraseña correcta entra" — read today as "once the lock has actually
  // elapsed", per S01's 2026-09-01 amendment: a correct password no longer
  // clears the lock immediately after the fifth failure (that silent bypass
  // is exactly what S01 closed, see routes/auth.integration.test.ts's
  // sibling assertion above and auth/service.ts's `passwordOk` branch) — the
  // legitimate holder gets the informative 423 first, same as everyone else
  // who has not waited it out.
  it('lets the legitimate holder log in once the lock has actually elapsed, clearing it (SEC-001)', async () => {
    const usuario = await insertUsuario();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });

    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: usuario.email, password: 'wrong-password' },
      });
    }

    const [locked] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, usuario.id));
    expect(locked?.bloqueadoHasta).not.toBeNull();

    // Immediately after the fifth failure, even the correct password is
    // refused with the informative 423 — S01's fix, proven end to end here
    // before moving the clock forward to reach the case this test is named
    // for.
    const stillLocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });
    expect(stillLocked.statusCode).toBe(423);

    // No code path clears a lock before its window elapses (12h fixed TTL
    // sessions aside) — force it into the past directly in the DB, same
    // technique as the expired-session test above.
    await db
      .update(usuarios)
      .set({ bloqueadoHasta: new Date(Date.now() - 1_000) })
      .where(eq(usuarios.id, usuario.id));

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);

    // Assert the database after the success, not just the status code: the
    // lock must be gone, or the next attempt would be refused again and the
    // denial of service would simply be one login longer.
    const [after] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, usuario.id));
    expect(after?.bloqueadoHasta).toBeNull();
    expect(after?.intentosFallidos).toBe(0);
  });

  it('changes the password, revokes other sessions, and keeps the current session valid', async () => {
    const usuario = await insertUsuario();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });

    // Two independent sessions for the same user: A performs the change,
    // B is "elsewhere" and must be revoked.
    const loginA = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });
    const cookieA = extractCookie(loginA.headers['set-cookie']);

    const loginB = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });
    const cookieB = extractCookie(loginB.headers['set-cookie']);

    const changeResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: cookieA },
      payload: {
        currentPassword: PASSWORD,
        newPassword: 'a-brand-new-password',
      },
    });
    expect(changeResponse.statusCode).toBe(200);

    const meViaB = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieB },
    });
    expect(meViaB.statusCode).toBe(401);

    const meViaA = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieA },
    });
    expect(meViaA.statusCode).toBe(200);
    expect(meViaA.json().usuario.debeCambiarPassword).toBe(false);
  });

  it('writes exactly one auditoria row for a password change, with hash_contrasena excluded from both snapshots (design.md D6/D11)', async () => {
    const usuario = await insertUsuario();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });
    const cookie = extractCookie(login.headers['set-cookie']);

    const changeResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie },
      payload: {
        currentPassword: PASSWORD,
        newPassword: 'a-brand-new-password',
      },
    });
    expect(changeResponse.statusCode).toBe(200);

    const rows = await db
      .select()
      .from(auditoria)
      .where(eq(auditoria.usuarioId, usuario.id));

    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (!row) {
      throw new Error('expected exactly one auditoria row');
    }
    expect(row.entidad).toBe('usuarios');
    expect(row.entidadId).toBe(usuario.id);
    expect(row.accion).toBe('cambiar_password');
    expect(row.datosPrevios).not.toBeNull();
    expect(row.datosPrevios).not.toHaveProperty('hash_contrasena');
    expect(row.datosPrevios).not.toHaveProperty('hashContrasena');
    expect(row.datosPosteriores).not.toHaveProperty('hash_contrasena');
    expect(row.datosPosteriores).not.toHaveProperty('hashContrasena');
  });

  it('rolls back the whole operation when the audit write fails: password unchanged, other sessions NOT revoked, 500 AUDIT_WRITE_FAILED (spec Scenario 4)', async () => {
    const usuario = await insertUsuario();
    // A UnitOfWork that runs a REAL Postgres transaction (proving the
    // rollback, not simulating it) but whose auditoria repo is swapped for
    // one that always throws — the same shape a real insert failure (e.g.
    // the FK/CHECK constraints) would produce (design.md D1, D5, D8; spec
    // Scenario 4).
    const brokenAuditUow: UnitOfWork = {
      run: (work) =>
        db.transaction((tx) => {
          const repos = buildRepos(tx);
          return work(
            {
              ...repos,
              auditoria: {
                record: async () => {
                  throw new Error('forced audit write failure');
                },
              },
            },
            { savepoint: async (_name, fn) => fn() },
          );
        }),
    };
    app = await buildApp({ cookieSecret: COOKIE_SECRET, uow: brokenAuditUow });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });
    const cookieA = extractCookie(login.headers['set-cookie']);

    const loginB = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });
    const cookieB = extractCookie(loginB.headers['set-cookie']);

    const changeResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: cookieA },
      payload: {
        currentPassword: PASSWORD,
        newPassword: 'a-brand-new-password',
      },
    });

    expect(changeResponse.statusCode).toBe(500);
    expect(changeResponse.json().error.code).toBe('AUDIT_WRITE_FAILED');

    // Password unchanged: the OLD password still authenticates.
    const reloginWithOld = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });
    expect(reloginWithOld.statusCode).toBe(200);

    // Session B was NOT revoked — still resolves.
    const meViaB = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieB },
    });
    expect(meViaB.statusCode).toBe(200);

    // No auditoria row was recorded.
    const rows = await db
      .select()
      .from(auditoria)
      .where(eq(auditoria.usuarioId, usuario.id));
    expect(rows).toHaveLength(0);
  });
});
