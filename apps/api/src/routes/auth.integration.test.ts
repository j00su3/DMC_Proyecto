import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import { usuarios } from '../db/schema.js';

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

    const lockedResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });

    expect(lockedResponse.statusCode).toBe(423);
    expect(lockedResponse.json().error.code).toBe('ACCOUNT_LOCKED');
  });
});
