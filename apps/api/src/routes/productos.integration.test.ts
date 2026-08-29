import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import { productos, proveedores, usuarios } from '../db/schema.js';
import { type UnitOfWork, createUnitOfWork } from '../db/uow.js';

// The REAL app over real Postgres. This is the ONLY proof anywhere in
// productos-ledger-base (backlog #5) of ADR-0003's invariant: `stock_actual`
// never changes without a paired `movimientos` row, and neither write
// persists if the other fails. Uses the same `failingUow` technique as
// `proveedores.integration.test.ts:526-543` — a REAL `createUnitOfWork(db)`
// with exactly one repository replaced by a thrower, so the surviving
// writes stay genuine and any rollback is a real Postgres ROLLBACK, not a
// stubbed one.
const db = getDb();
const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const PASSWORD = 'correct-horse-battery-staple';

async function seedUsuario(rol: 'encargado' | 'deposito' = 'encargado') {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre: 'Seed User',
      email: `productos-${randomUUID()}@example.com`,
      hashContrasena: await hashPassword(PASSWORD),
      rol,
    })
    .returning();
  if (!row) {
    throw new Error('seedUsuario: expected exactly one row back');
  }
  return row;
}

async function seedProveedor(activo = true) {
  const [row] = await db
    .insert(proveedores)
    .values({ nombre: `Distribuidora ${randomUUID()}`, activo })
    .returning();
  if (!row) {
    throw new Error('seedProveedor: expected exactly one row back');
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

function crearBody(overrides: Record<string, unknown> = {}) {
  return {
    nombre: 'Tornillo Phillips',
    sku: `TP-${randomUUID()}`,
    precio: '10.00',
    ...overrides,
  };
}

async function countRows(table: string) {
  const result = await db.execute(
    sql.raw(`select count(*)::int as n from ${table}`),
  );
  return (result as unknown as { rows: { n: number }[] }).rows[0]?.n ?? -1;
}

async function movimientosFor(productoId: string) {
  const result = await db.execute(
    sql`select tipo, cantidad, stock_resultante, es_discrepancia, motivo
          from movimientos where producto_id = ${productoId}`,
  );
  return (
    result as unknown as {
      rows: {
        tipo: string;
        cantidad: number;
        stock_resultante: number;
        es_discrepancia: boolean;
        motivo: string | null;
      }[];
    }
  ).rows;
}

async function sumMovimientos(productoId: string) {
  const result = await db.execute(
    sql`select coalesce(sum(cantidad), 0)::int as total from movimientos where producto_id = ${productoId}`,
  );
  return (result as unknown as { rows: { total: number }[] }).rows[0]
    ?.total as number;
}

// File scope, NOT inside a describe — closing the pool inside the first
// describe would kill it for every later describe in this file
// (usuarios.integration.test.ts / proveedores.integration.test.ts D-note).
afterAll(async () => {
  await getPool().end();
});

describe('POST /api/productos — atomicity proof (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table auditoria, movimientos, productos, sesiones, proveedores, usuarios cascade`,
    );
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('writes stock_actual and exactly one paired movimientos row in one transaction (positive)', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/productos',
      payload: crearBody({ proveedorId: proveedor.id, stockInicial: 5 }),
      cookies: { sid },
    });

    expect(response.statusCode).toBe(201);
    const producto = response.json().producto;
    expect(producto.stockActual).toBe(5);

    const rows = await movimientosFor(producto.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tipo: 'ajuste',
      cantidad: 5,
      stock_resultante: 5,
      es_discrepancia: false,
      motivo: 'stock inicial (alta de producto)',
    });

    const sum = await sumMovimientos(producto.id);
    expect(sum).toBe(producto.stockActual);
  });

  it('rolls back the whole create when the paired movimientos write fails: zero productos, zero movimientos, zero auditoria', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();

    const realUow = createUnitOfWork(db);
    const failingUow: UnitOfWork = {
      run: (work) =>
        realUow.run((repos) =>
          work({
            ...repos,
            movimientos: {
              create: async () => {
                throw new Error('forced movimientos failure');
              },
            },
          }),
        ),
    };
    app = await buildApp({ cookieSecret: COOKIE_SECRET, uow: failingUow });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/productos',
      payload: crearBody({
        proveedorId: proveedor.id,
        sku: 'TP-LEDGER-FAIL',
        stockInicial: 5,
      }),
      cookies: { sid },
    });

    expect(response.statusCode).toBe(500);

    expect(await countRows('productos')).toBe(0);
    expect(await countRows('movimientos')).toBe(0);
    expect(await countRows('auditoria')).toBe(0);
  });

  it('rolls back the whole create when the paired audit write fails: zero productos, zero movimientos, zero auditoria, 500 AUDIT_WRITE_FAILED', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();

    const realUow = createUnitOfWork(db);
    const failingUow: UnitOfWork = {
      run: (work) =>
        realUow.run((repos) =>
          work({
            ...repos,
            auditoria: {
              record: async () => {
                throw new Error('forced audit failure');
              },
            },
          }),
        ),
    };
    app = await buildApp({ cookieSecret: COOKIE_SECRET, uow: failingUow });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/productos',
      payload: crearBody({
        proveedorId: proveedor.id,
        sku: 'TP-AUDIT-FAIL',
        stockInicial: 5,
      }),
      cookies: { sid },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('AUDIT_WRITE_FAILED');

    expect(await countRows('productos')).toBe(0);
    expect(await countRows('movimientos')).toBe(0);
    expect(await countRows('auditoria')).toBe(0);
  });

  it('creates the product row with zero movimientos rows when stockInicial is 0', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/productos',
      payload: crearBody({ proveedorId: proveedor.id, stockInicial: 0 }),
      cookies: { sid },
    });

    expect(response.statusCode).toBe(201);
    const producto = response.json().producto;
    expect(producto.stockActual).toBe(0);

    const [row] = await db
      .select()
      .from(productos)
      .where(eq(productos.id, producto.id));
    expect(row).toBeDefined();

    const rows = await movimientosFor(producto.id);
    expect(rows).toHaveLength(0);
  });
});
