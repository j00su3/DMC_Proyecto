import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import {
  alertas,
  movimientos,
  productos,
  proveedores,
  usuarios,
} from '../db/schema.js';

// The real app over real Postgres — proves the dashboard route's wiring end
// to end (both roles, real repos), not just the handler against fakes (see
// routes/reportes.integration.test.ts's precedent docblock).
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
      email: `dashboard-${randomUUID()}@example.com`,
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

describe('dashboard route (integration, real app + real Postgres)', () => {
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

  it('both roles get 200 with the same shape and counts for a fixed set of alertas/movimientos', async () => {
    const [proveedor] = await db
      .insert(proveedores)
      .values({ nombre: `Proveedor ${randomUUID()}` })
      .returning();
    if (!proveedor) throw new Error('expected proveedor row');
    const [producto] = await db
      .insert(productos)
      .values({
        nombre: 'Producto Dashboard',
        sku: `SKU-${randomUUID()}`,
        precio: '10.00',
        proveedorId: proveedor.id,
      })
      .returning();
    if (!producto) throw new Error('expected producto row');
    const actor = await seedUsuario('deposito', 'Actor');
    await db.insert(movimientos).values({
      productoId: producto.id,
      usuarioId: actor.id,
      tipo: 'entrada',
      cantidad: 1,
      stockResultante: 1,
    });
    await db.insert(alertas).values({
      productoId: producto.id,
      tipo: 'quiebre',
    });

    for (const rol of ['encargado', 'deposito'] as const) {
      const usuario = await seedUsuario(rol, `Sesion ${rol}`);
      const sid = await loginAs(
        app as Awaited<ReturnType<typeof buildApp>>,
        usuario.email,
      );

      const response = await (
        app as Awaited<ReturnType<typeof buildApp>>
      ).inject({
        method: 'GET',
        url: '/api/dashboard/resumen',
        cookies: { sid },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        quiebres: 1,
        stockBajo: 0,
        alertasActivas: 1,
      });
      expect(body.actividadReciente).toHaveLength(1);
      expect(body.actividadReciente[0]).toMatchObject({
        productoId: producto.id,
        productoNombre: 'Producto Dashboard',
        tipo: 'entrada',
        usuarioId: actor.id,
      });
    }
  });

  it('returns 401 without a session', async () => {
    if (!app) throw new Error('app not built');

    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/resumen',
    });

    expect(response.statusCode).toBe(401);
  });
});
