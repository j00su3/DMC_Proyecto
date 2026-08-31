import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import { productos, proveedores, usuarios } from '../db/schema.js';
import { type UnitOfWork, createUnitOfWork } from '../db/uow.js';

// tasks.md S5 (mandatory, not droppable): the real-Postgres proof.
// S3 (movimientos/service.test.ts) already proves atomicity and
// audit-absence against fake repos/spies; a fake can be made to say
// anything. This file proves the same properties against a genuine
// Postgres transaction, using the exact `failingUow` technique from
// `proveedores.integration.test.ts:526-543` and
// `productos.integration.test.ts` — a REAL `createUnitOfWork(db)` with only
// the failing dependency swapped out, so the surviving writes (or the
// ROLLBACK) are real, never stubbed.
const db = getDb();
const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const PASSWORD = 'correct-horse-battery-staple';

async function seedUsuario(rol: 'encargado' | 'deposito' = 'encargado') {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre: 'Seed User',
      email: `movimientos-int-${randomUUID()}@example.com`,
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
    .values({ nombre: `Distribuidora ${randomUUID()}` })
    .returning();
  if (!row) {
    throw new Error('seedProveedor: expected exactly one row back');
  }
  return row;
}

async function seedProducto(proveedorId: string, stockActual = 0) {
  const [row] = await db
    .insert(productos)
    .values({
      nombre: 'Tornillo Phillips',
      sku: `TP-${randomUUID()}`,
      precio: '10.00',
      proveedorId,
      stockActual,
    })
    .returning();
  if (!row) {
    throw new Error('seedProducto: expected exactly one row back');
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

async function countRows(table: string) {
  const result = await db.execute(
    sql.raw(`select count(*)::int as n from ${table}`),
  );
  return (result as unknown as { rows: { n: number }[] }).rows[0]?.n ?? -1;
}

async function movimientosCountFor(productoId: string) {
  const result = await db.execute(
    sql`select count(*)::int as n from movimientos where producto_id = ${productoId}`,
  );
  return (result as unknown as { rows: { n: number }[] }).rows[0]?.n ?? -1;
}

async function sumMovimientos(productoId: string) {
  const result = await db.execute(
    sql`select coalesce(sum(cantidad), 0)::int as total from movimientos where producto_id = ${productoId}`,
  );
  return (result as unknown as { rows: { total: number }[] }).rows[0]
    ?.total as number;
}

async function stockActualFor(productoId: string) {
  const [row] = await db
    .select({ stockActual: productos.stockActual })
    .from(productos)
    .where(eq(productos.id, productoId));
  if (!row) {
    throw new Error('stockActualFor: producto vanished');
  }
  return row.stockActual;
}

function failingMovimientosUow(): UnitOfWork {
  const realUow = createUnitOfWork(db);
  return {
    run: (work) =>
      realUow.run((repos) =>
        work({
          ...repos,
          movimientos: {
            create: async () => {
              throw new Error('forced movimientos failure');
            },
            listByProducto: async () => ({ rows: [], total: 0 }),
          },
        }),
      ),
  };
}

// File scope, NOT inside a describe — closing the pool inside the first
// describe would kill it for every later describe in this file (see the
// same D-note in proveedores/usuarios/productos integration suites).
afterAll(async () => {
  await getPool().end();
});

describe('movimientos routes (integration, real app + real Postgres)', () => {
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

  it('1. ledger write fails ⇒ nothing survives: stock_actual unchanged, zero new movimientos rows', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, 10);

    app = await buildApp({
      cookieSecret: COOKIE_SECRET,
      uow: failingMovimientosUow(),
    });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/entrada`,
      payload: { cantidad: 5 },
      cookies: { sid },
    });

    expect(response.statusCode).toBe(500);
    expect(await stockActualFor(producto.id)).toBe(10);
    expect(await movimientosCountFor(producto.id)).toBe(0);
  });

  it('2. 403 writes nothing: a real deposito session against ajuste is refused and touches no row', async () => {
    const deposito = await seedUsuario('deposito');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, 10);

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, deposito.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/ajuste`,
      payload: {
        cantidad: 5,
        direccion: 'sumar',
        esDiscrepancia: false,
        motivo: 'conteo fisico',
      },
      cookies: { sid },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
    expect(await stockActualFor(producto.id)).toBe(10);
    expect(await movimientosCountFor(producto.id)).toBe(0);
  });

  it('3. INSUFFICIENT_STOCK reports the real stock read inside the transaction', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, 3);

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/salida`,
      payload: { cantidad: 5, esMerma: false },
      cookies: { sid },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(body.error.details).toEqual({ available: 3 });
    expect(await stockActualFor(producto.id)).toBe(3);
    expect(await movimientosCountFor(producto.id)).toBe(0);
  });

  it('4. Σ(cantidad) = stock_actual after a mixed entrada/salida/ajuste sequence', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, 0);

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    let response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/entrada`,
      payload: { cantidad: 10 },
      cookies: { sid },
    });
    expect(response.statusCode).toBe(201);

    response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/salida`,
      payload: { cantidad: 3, esMerma: false },
      cookies: { sid },
    });
    expect(response.statusCode).toBe(201);

    response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/ajuste`,
      payload: {
        cantidad: 2,
        direccion: 'sumar',
        esDiscrepancia: true,
        motivo: 'conteo fisico',
      },
      cookies: { sid },
    });
    expect(response.statusCode).toBe(201);

    response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/ajuste`,
      payload: {
        cantidad: 1,
        direccion: 'restar',
        esDiscrepancia: false,
        motivo: 'conteo fisico',
      },
      cookies: { sid },
    });
    expect(response.statusCode).toBe(201);

    // 10 - 3 + 2 - 1 = 8
    const stockActual = await stockActualFor(producto.id);
    expect(stockActual).toBe(8);
    expect(await sumMovimientos(producto.id)).toBe(stockActual);
  });

  it('5. no auditoria row for any movement — entrada, salida and ajuste all leave auditoria untouched', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, 20);

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const before = await countRows('auditoria');
    expect(before).toBe(0);

    let response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/entrada`,
      payload: { cantidad: 5 },
      cookies: { sid },
    });
    expect(response.statusCode).toBe(201);
    expect(await countRows('auditoria')).toBe(before);

    response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/salida`,
      payload: { cantidad: 2, esMerma: false },
      cookies: { sid },
    });
    expect(response.statusCode).toBe(201);
    expect(await countRows('auditoria')).toBe(before);

    response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/ajuste`,
      payload: {
        cantidad: 1,
        direccion: 'sumar',
        esDiscrepancia: false,
        motivo: 'conteo fisico',
      },
      cookies: { sid },
    });
    expect(response.statusCode).toBe(201);
    expect(await countRows('auditoria')).toBe(before);
  });

  it('6. a merma salida persists es_merma = true, distinct from an ordinary salida (es_merma = false), both readable via history', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, 20);

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    let response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/salida`,
      payload: { cantidad: 2, esMerma: true, motivo: 'producto danado' },
      cookies: { sid },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().movimiento.esMerma).toBe(true);

    response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/salida`,
      payload: { cantidad: 3, esMerma: false },
      cookies: { sid },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().movimiento.esMerma).toBe(false);

    const history = await app.inject({
      method: 'GET',
      url: `/api/productos/${producto.id}/movimientos?page=1&pageSize=10`,
      cookies: { sid },
    });
    expect(history.statusCode).toBe(200);
    const { data } = history.json();
    const salidas: { cantidad: number; esMerma: boolean }[] = data;
    expect(salidas).toHaveLength(2);

    const mermaRow = salidas.find((row) => row.cantidad === -2);
    const ordinaryRow = salidas.find((row) => row.cantidad === -3);
    expect(mermaRow?.esMerma).toBe(true);
    expect(ordinaryRow?.esMerma).toBe(false);
  });

  /**
   * Closes the one untested spec scenario `sdd-verify` found at `643dfb6`:
   * `specs/inventory-movements/spec.md:104-112`, "Motivo Is Free Text With No
   * Closed Reason List" / "Arbitrary reason text is accepted and stored
   * verbatim" (PD-3). No assertion on `motivo` content existed anywhere in
   * this module's tests — the behaviour was correct by inspection (a plain
   * Drizzle `text` column with no transformation) but unproven at runtime,
   * and "correct by inspection" is exactly what this project does not accept.
   *
   * Read back from the COLUMN, not from the response body: the requirement is
   * about what is *persisted*. A handler echoing its own input satisfies a
   * response-only assertion while writing something else.
   *
   * Two motivos, because the requirement has two halves. The first is the
   * spec's own literal string, non-ASCII accents included, proving byte-exact
   * storage. The second is deliberately nothing like an inventory reason,
   * proving no closed list is consulted — a whitelist would reject it while
   * still accepting the first.
   *
   * The wire schema applies `.trim()` (`routes/movimientos.ts:27-32`), so
   * "verbatim" means the trimmed value is stored unaltered; both strings here
   * have no leading or trailing whitespace, matching the spec's scenario.
   */
  it('7. motivo is free text: stored byte-exact in the column, with no closed reason list', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, 20);

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const specMotivo = 'Conteo físico mensual';
    const arbitraryMotivo = 'Se lo llevó el gato, 3er piso — ticket #42/A';

    let response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/ajuste`,
      payload: {
        cantidad: 2,
        direccion: 'sumar',
        esDiscrepancia: false,
        motivo: specMotivo,
      },
      cookies: { sid },
    });
    expect(response.statusCode).toBe(201);

    response = await app.inject({
      method: 'POST',
      url: `/api/productos/${producto.id}/movimientos/salida`,
      payload: { cantidad: 1, esMerma: true, motivo: arbitraryMotivo },
      cookies: { sid },
    });
    expect(response.statusCode).toBe(201);

    const persisted = await db.execute(
      sql`select cantidad, motivo from movimientos where producto_id = ${producto.id} order by cantidad desc`,
    );
    const rows = (
      persisted as unknown as { rows: { cantidad: number; motivo: string }[] }
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.motivo).toBe(specMotivo);
    expect(rows[1]?.motivo).toBe(arbitraryMotivo);

    const history = await app.inject({
      method: 'GET',
      url: `/api/productos/${producto.id}/movimientos?page=1&pageSize=10`,
      cookies: { sid },
    });
    expect(history.statusCode).toBe(200);
    const motivos: string[] = history
      .json()
      .data.map((row: { motivo: string }) => row.motivo);
    expect(motivos).toContain(specMotivo);
    expect(motivos).toContain(arbitraryMotivo);
  });
});
