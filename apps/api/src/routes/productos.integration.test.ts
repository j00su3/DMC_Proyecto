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

async function auditRowsFor(entidadId: string) {
  const result = await db.execute(
    sql`select entidad, accion from auditoria where entidad_id = ${entidadId} order by creado_en`,
  );
  return (result as unknown as { rows: { entidad: string; accion: string }[] })
    .rows;
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
        realUow.run((repos, tx) =>
          work(
            {
              ...repos,
              movimientos: {
                ...repos.movimientos,
                create: async () => {
                  throw new Error('forced movimientos failure');
                },
                listByProducto: async () => ({ rows: [], total: 0 }),
              },
            },
            tx,
          ),
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
        realUow.run((repos, tx) =>
          work(
            {
              ...repos,
              auditoria: {
                record: async () => {
                  throw new Error('forced audit failure');
                },
              },
            },
            tx,
          ),
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

// tasks.md Phase 9 (S5-breadth): re-proving RBAC, the field guard, the audit
// trail and search/pagination against the real app + real Postgres, the
// same wiring proof this file already gives S5-core's atomicity claim.
describe('productos RBAC and field guard (integration, real app + real Postgres)', () => {
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

  it('refuses a real deposito session on deactivate and reactivate, table unchanged', async () => {
    const encargado = await seedUsuario('encargado');
    const deposito = await seedUsuario('deposito');
    const proveedor = await seedProveedor();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const actorSid = await loginAs(app, encargado.email);
    const created = await app.inject({
      method: 'POST',
      url: '/api/productos',
      payload: crearBody({ proveedorId: proveedor.id }),
      cookies: { sid: actorSid },
    });
    const id = created.json().producto.id;

    const sid = await loginAs(app, deposito.email);

    const deactivate = await app.inject({
      method: 'POST',
      url: `/api/productos/${id}/deactivate`,
      cookies: { sid },
    });
    expect(deactivate.statusCode).toBe(403);
    expect(deactivate.json().error.code).toBe('FORBIDDEN');

    const reactivate = await app.inject({
      method: 'POST',
      url: `/api/productos/${id}/reactivate`,
      cookies: { sid },
    });
    expect(reactivate.statusCode).toBe(403);
    expect(reactivate.json().error.code).toBe('FORBIDDEN');

    // Nothing moved: still active (a deactivate would have flipped it), and
    // only the encargado's own crear row exists in the trail.
    const [row] = await db.select().from(productos).where(eq(productos.id, id));
    expect(row?.activo).toBe(true);
    const auditRows = await auditRowsFor(id);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.accion).toBe('crear');
  });

  it('refuses a real deposito session sending stockMinimo (value or null) on create, no row written', async () => {
    const deposito = await seedUsuario('deposito');
    const proveedor = await seedProveedor();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, deposito.email);

    const before = await countRows('productos');

    const withValue = await app.inject({
      method: 'POST',
      url: '/api/productos',
      payload: crearBody({
        proveedorId: proveedor.id,
        sku: 'TP-DEPOSITO-VALUE',
        stockMinimo: 5,
      }),
      cookies: { sid },
    });
    expect(withValue.statusCode).toBe(403);
    expect(withValue.json().error.code).toBe('FIELD_RESERVED_FOR_ENCARGADO');

    // Key-presence guard (Object.hasOwn), not a value check: `stockMinimo:
    // null` must be refused exactly as hard as a real number.
    const withNull = await app.inject({
      method: 'POST',
      url: '/api/productos',
      payload: crearBody({
        proveedorId: proveedor.id,
        sku: 'TP-DEPOSITO-NULL',
        stockMinimo: null,
      }),
      cookies: { sid },
    });
    expect(withNull.statusCode).toBe(403);
    expect(withNull.json().error.code).toBe('FIELD_RESERVED_FOR_ENCARGADO');

    expect(await countRows('productos')).toBe(before);
  });
});

describe('productos audit trail per mutation type (integration, real app + real Postgres)', () => {
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

  it('records exactly one auditoria row per mutation type, all entidad = productos', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/productos',
      payload: crearBody({ proveedorId: proveedor.id }),
      cookies: { sid },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().producto.id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/productos/${id}`,
      payload: { nombre: 'Tornillo Actualizado' },
      cookies: { sid },
    });
    expect(updated.statusCode).toBe(200);

    const deactivated = await app.inject({
      method: 'POST',
      url: `/api/productos/${id}/deactivate`,
      cookies: { sid },
    });
    expect(deactivated.statusCode).toBe(200);

    const reactivated = await app.inject({
      method: 'POST',
      url: `/api/productos/${id}/reactivate`,
      cookies: { sid },
    });
    expect(reactivated.statusCode).toBe(200);

    const rows = await auditRowsFor(id);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.entidad === 'productos')).toBe(true);
    expect(rows.map((row) => row.accion)).toEqual([
      'crear',
      'actualizar',
      'baja_logica',
      'reactivar',
    ]);
  });
});

describe('productos search and pagination (integration, real app + real Postgres)', () => {
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

  it('searches by name or sku and paginates a real seeded table, asserting both data and total', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    // Two match by name, one matches only by SKU (D7's ILIKE-over-both
    // predicate) and one matches neither.
    for (const [nombre, skuSuffix] of [
      ['Martillo Grande', randomUUID()],
      ['Martillo Chico', randomUUID()],
      ['Destornillador Plano', randomUUID()],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/productos',
        payload: crearBody({
          proveedorId: proveedor.id,
          nombre,
          sku: `SKU-${skuSuffix}`,
        }),
        cookies: { sid },
      });
      expect(response.statusCode).toBe(201);
    }
    const skuMatch = await app.inject({
      method: 'POST',
      url: '/api/productos',
      payload: crearBody({
        proveedorId: proveedor.id,
        nombre: 'Llave Inglesa',
        sku: `MARTILLO-${randomUUID()}`,
      }),
      cookies: { sid },
    });
    expect(skuMatch.statusCode).toBe(201);

    // total for the search must come from the SAME filtered predicate as
    // data, not a whole-table count (design.md D7's exact failure mode: a
    // predicate applied to only the page query leaves total wrong).
    const search = await app.inject({
      method: 'GET',
      url: '/api/productos?q=martillo',
      cookies: { sid },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().total).toBe(3);
    expect(search.json().data).toHaveLength(3);

    const page1 = await app.inject({
      method: 'GET',
      url: '/api/productos?page=1&pageSize=2',
      cookies: { sid },
    });
    expect(page1.json().total).toBe(4);
    expect(page1.json().data).toHaveLength(2);

    const outOfRange = await app.inject({
      method: 'GET',
      url: '/api/productos?page=5&pageSize=2',
      cookies: { sid },
    });
    expect(outOfRange.json().total).toBe(4);
    expect(outOfRange.json().data).toHaveLength(0);
  });
});
