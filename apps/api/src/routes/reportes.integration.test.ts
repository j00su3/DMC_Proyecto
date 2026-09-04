import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import { usuarios } from '../db/schema.js';

// The real app over real Postgres — proves the routes' wiring end to end,
// not just the handlers against fakes (see
// routes/proveedores.integration.test.ts's precedent docblock).
const db = getDb();
const PASSWORD = 'correct-horse-battery-staple';

async function seedUsuario(
  rol: 'encargado' | 'deposito',
  nombre = 'Seed User',
) {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre,
      email: `reportes-${randomUUID()}@example.com`,
      hashContrasena: await hashPassword(PASSWORD),
      rol,
    })
    .returning();
  if (!row) {
    throw new Error('seedUsuario: expected exactly one row back');
  }
  return row;
}

async function loginAs(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: PASSWORD },
  });
  if (response.statusCode !== 200) {
    throw new Error(`loginAs: expected 200, got ${response.statusCode}`);
  }
  const raw = response.headers['set-cookie'];
  const cookie = Array.isArray(raw) ? raw[0] : raw;
  const sid = /sid=([^;]+)/.exec(cookie ?? '')?.[1];
  if (!sid) {
    throw new Error('loginAs: no sid cookie in the login response');
  }
  return decodeURIComponent(sid);
}

afterAll(async () => {
  await getPool().end();
});

describe('reportes routes (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table auditoria, sesiones, movimientos, alertas, productos, proveedores, usuarios cascade`,
    );
    app = await buildApp({
      cookieSecret: 'test-cookie-secret-at-least-32-characters-long',
    });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('an empty-range movimientos request returns {data: [], total: 0} with a 2xx status, not an error', async () => {
    if (!app) throw new Error('app not built');
    const encargado = await seedUsuario('encargado');
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/reportes/movimientos?fechaDesde=2027-01-01&fechaHasta=2027-01-31&page=1&pageSize=20',
      cookies: { sid },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(200);
    expect(response.statusCode).toBeLessThan(300);
    expect(response.json()).toMatchObject({ data: [], total: 0 });
  });

  it('rejects page=0 via the existing pageQuerySchema.min(1) — regression coverage only', async () => {
    if (!app) throw new Error('app not built');
    const encargado = await seedUsuario('encargado');
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/reportes/stock-actual?page=0&pageSize=20',
      cookies: { sid },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a negative pageSize via the existing pageQuerySchema.min(1) — regression coverage only', async () => {
    if (!app) throw new Error('app not built');
    const encargado = await seedUsuario('encargado');
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/reportes/bajo-minimo?page=1&pageSize=-5',
      cookies: { sid },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 with no data leak for a deposito on discrepancias', async () => {
    if (!app) throw new Error('app not built');
    const deposito = await seedUsuario('deposito');
    const sid = await loginAs(app, deposito.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/reportes/discrepancias?page=1&pageSize=20',
      cookies: { sid },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().data).toBeUndefined();
  });
});
