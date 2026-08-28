import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import { usuarios } from '../db/schema.js';

// The REAL app over real Postgres: real repos, real RBAC hook, real session
// cookie. The unit suite proves the handlers against fakes; this proves the
// wiring the fakes stand in for — that the routes are registered after
// authPlugin, that a real login produces a cookie these routes accept, and
// that a row read out of Postgres serialises without its hash.
const db = getDb();
const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const PASSWORD = 'correct-horse-battery-staple';

async function seedUsuario(
  rol: 'encargado' | 'deposito',
  nombre = 'Seed User',
) {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre,
      email: `routes-${randomUUID()}@example.com`,
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

describe('usuarios read routes (integration, real app + real Postgres)', () => {
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

  it('lists real rows for an encargado and never serialises the hash', async () => {
    const encargado = await seedUsuario('encargado', 'Ana Encargada');
    await seedUsuario('deposito', 'Beto Deposito');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/usuarios',
      cookies: { sid },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    // Asserted on the raw body, not on parsed keys: the hash must not appear
    // anywhere in the bytes that leave the process.
    expect(response.body).not.toContain('hashContrasena');
    expect(response.body).not.toContain('hash_contrasena');
    expect(response.body).not.toContain(encargado.hashContrasena);
  });

  it('returns 403 for a real deposito session', async () => {
    const deposito = await seedUsuario('deposito');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, deposito.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/usuarios',
      cookies: { sid },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('gets one real row by id and never serialises the hash', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Beto Deposito');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'GET',
      url: `/api/usuarios/${objetivo.id}`,
      cookies: { sid },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().usuario).toMatchObject({
      id: objetivo.id,
      nombre: 'Beto Deposito',
      rol: 'deposito',
      activo: true,
    });
    expect(response.body).not.toContain('hashContrasena');
    expect(response.body).not.toContain(objetivo.hashContrasena);
  });

  it('returns 404 USER_NOT_FOUND for a well-formed id that matches no row', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/usuarios/00000000-0000-4000-8000-000000000000',
      cookies: { sid },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('USER_NOT_FOUND');
  });

  it('paginates real rows without overlap across pages', async () => {
    const encargado = await seedUsuario('encargado');
    await seedUsuario('deposito', 'Uno');
    await seedUsuario('deposito', 'Dos');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const page1 = await app.inject({
      method: 'GET',
      url: '/api/usuarios?page=1&pageSize=2',
      cookies: { sid },
    });
    const page2 = await app.inject({
      method: 'GET',
      url: '/api/usuarios?page=2&pageSize=2',
      cookies: { sid },
    });

    expect(page1.json().total).toBe(3);
    expect(page2.json().total).toBe(3);
    const ids = [
      ...page1.json().data.map((r: { id: string }) => r.id),
      ...page2.json().data.map((r: { id: string }) => r.id),
    ];
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});
