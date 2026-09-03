import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import { alertas, productos, proveedores, usuarios } from '../db/schema.js';

// The REAL app over real Postgres — mirrors proveedores.integration.test.ts.
// `routes/alertas.test.ts` proves the handlers against fakes; this proves
// design.md's Testing Strategy "Route" row: a genuine deposito 403 on the
// resolve route AND the row genuinely staying activa, plus the resolve
// route's audit row genuinely landing in the same transaction as the write.
const db = getDb();
const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const PASSWORD = 'correct-horse-battery-staple';

async function seedUsuario(rol: 'encargado' | 'deposito') {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre: 'Seed User',
      email: `alertas-route-${randomUUID()}@example.com`,
      hashContrasena: await hashPassword(PASSWORD),
      rol,
    })
    .returning();
  if (!row) {
    throw new Error('seedUsuario: expected exactly one row back');
  }
  return row;
}

async function seedProveedor() {
  const [row] = await db
    .insert(proveedores)
    .values({ nombre: `Proveedor ${randomUUID()}` })
    .returning();
  if (!row) {
    throw new Error('seedProveedor: expected exactly one row back');
  }
  return row;
}

async function seedProducto(proveedorId: string) {
  const [row] = await db
    .insert(productos)
    .values({
      nombre: 'Producto Seed',
      sku: `SKU-${randomUUID()}`,
      precio: '10.00',
      proveedorId,
    })
    .returning();
  if (!row) {
    throw new Error('seedProducto: expected exactly one row back');
  }
  return row;
}

async function seedAlerta(
  productoId: string,
  tipo: 'discrepancia' | 'stock_bajo' | 'quiebre' = 'discrepancia',
) {
  const [row] = await db
    .insert(alertas)
    .values({ productoId, tipo })
    .returning();
  if (!row) {
    throw new Error('seedAlerta: expected exactly one row back');
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

async function auditRowsFor(entidadId: string) {
  const result = await db.execute(
    sql`select entidad, accion, usuario_id from auditoria where entidad_id = ${entidadId} order by creado_en`,
  );
  return (
    result as unknown as {
      rows: { entidad: string; accion: string; usuario_id: string }[];
    }
  ).rows;
}

afterAll(async () => {
  await getPool().end();
});

describe('alertas routes (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table auditoria, sesiones, alertas, movimientos, productos, proveedores, usuarios cascade`,
    );
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('lets a real deposito session read the list, the count, and mark alerts as vistas', async () => {
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id);
    await seedAlerta(producto.id);
    const deposito = await seedUsuario('deposito');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, deposito.email);

    const list = await app.inject({
      method: 'GET',
      url: '/api/alertas',
      cookies: { sid },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);
    expect(list.json().data[0].productoNombre).toBe('Producto Seed');

    const conteo = await app.inject({
      method: 'GET',
      url: '/api/alertas/conteo',
      cookies: { sid },
    });
    expect(conteo.statusCode).toBe(200);
    expect(conteo.json().abiertas).toBe(1);

    const marcar = await app.inject({
      method: 'POST',
      url: '/api/alertas/marcar-vistas',
      cookies: { sid },
    });
    expect(marcar.statusCode).toBe(200);
    expect(marcar.json().marcadas).toBe(1);

    const [row] = await db
      .select()
      .from(alertas)
      .where(eq(alertas.productoId, producto.id));
    expect(row?.estado).toBe('vista');
  });

  it('refuses a real deposito session on the resolve route — no row moves, no audit row', async () => {
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id);
    const alerta = await seedAlerta(producto.id, 'discrepancia');
    const deposito = await seedUsuario('deposito');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, deposito.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/alertas/${alerta.id}/resolver`,
      cookies: { sid },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');

    const [row] = await db
      .select()
      .from(alertas)
      .where(eq(alertas.id, alerta.id));
    expect(row?.estado).toBe('activa');
    expect(row?.resueltaPor).toBeNull();

    const rows = await auditRowsFor(alerta.id);
    expect(rows).toHaveLength(0);
  });

  it('lets a real encargado session resolve a discrepancia and audits it in the same transaction', async () => {
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id);
    const alerta = await seedAlerta(producto.id, 'discrepancia');
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/alertas/${alerta.id}/resolver`,
      cookies: { sid },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().alerta.estado).toBe('resuelta');
    expect(response.json().alerta.resueltaPor).toBe(encargado.id);

    const [row] = await db
      .select()
      .from(alertas)
      .where(eq(alertas.id, alerta.id));
    expect(row?.estado).toBe('resuelta');

    const rows = await auditRowsFor(alerta.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accion).toBe('actualizar');
    expect(rows[0]?.usuario_id).toBe(encargado.id);
  });

  it('returns 409 ALERT_NOT_MANUALLY_RESOLVABLE for a real activa stock_bajo alert', async () => {
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id);
    const alerta = await seedAlerta(producto.id, 'stock_bajo');
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/alertas/${alerta.id}/resolver`,
      cookies: { sid },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ALERT_NOT_MANUALLY_RESOLVABLE');

    const [row] = await db
      .select()
      .from(alertas)
      .where(eq(alertas.id, alerta.id));
    expect(row?.estado).toBe('activa');
  });
});
