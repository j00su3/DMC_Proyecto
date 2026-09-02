import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import {
  itemsVenta,
  movimientos,
  pagos,
  productos,
  proveedores,
  usuarios,
  ventas,
} from '../db/schema.js';
import { type UnitOfWork, createUnitOfWork } from '../db/uow.js';

// design.md's Testing Strategy: "Integration (real PG, excluded from the
// default run)" row, plus tasks.md 4.1/4.2. Real `createUnitOfWork(db)`
// throughout — `routes/proveedores.integration.test.ts` /
// `routes/movimientos.integration.test.ts` precedent — a genuine ROLLBACK
// and a genuine correlativo gap are only provable here, never against fakes.
const db = getDb();
const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const PASSWORD = 'correct-horse-battery-staple';

async function seedUsuario(rol: 'encargado' | 'deposito' = 'encargado') {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre: 'Seed User',
      email: `ventas-int-${randomUUID()}@example.com`,
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

async function seedProducto(
  proveedorId: string,
  overrides: { nombre?: string; precio?: string; stockActual?: number } = {},
) {
  const [row] = await db
    .insert(productos)
    .values({
      nombre: overrides.nombre ?? 'Tornillo Phillips',
      sku: `SKU-${randomUUID()}`,
      precio: overrides.precio ?? '10.00',
      proveedorId,
      stockActual: overrides.stockActual ?? 0,
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

// File scope, NOT inside a describe: closing the pool inside the first
// describe would kill it for every later describe in this file (same D-note
// as proveedores/movimientos integration suites).
afterAll(async () => {
  await getPool().end();
});

describe('POST /api/ventas (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table pagos, items_venta, ventas, movimientos, auditoria, productos, sesiones, proveedores, usuarios cascade`,
    );
    // The sequence is NOT reset here on purpose — task 4.1's correlativo-gap
    // scenario depends on the sequence carrying state across truncates
    // within the same test, exactly as it would in production (TRUNCATE
    // never touches a sequence unless RESTART IDENTITY is given).
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('insufficient stock on the LAST sorted item leaves zero new rows in every table, and the next confirmed sale shows the correlativo gap (design.md D7/S6)', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();

    // producto_id ascending order (D3's ordenarItems) determines which item
    // is processed last in Pass B. Two products are seeded and then sorted
    // by id so the LAST one in that order is the one starved of stock —
    // this is what proves Pass B rolls back everything already applied to
    // the earlier item(s) in the same transaction, not just the failing one.
    const productoA = await seedProducto(proveedor.id, {
      nombre: 'Producto A',
      precio: '10.00',
      stockActual: 100,
    });
    const productoB = await seedProducto(proveedor.id, {
      nombre: 'Producto B',
      precio: '5.00',
      stockActual: 1,
    });
    // Independent of the two hero items below — used only to establish a
    // correlativo baseline without touching either item's stock accounting.
    const productoCanario = await seedProducto(proveedor.id, {
      nombre: 'Producto Canario',
      precio: '1.00',
      stockActual: 100,
    });
    const [ultimo, primero] = [productoA, productoB].sort((a, b) =>
      a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
    );
    if (!ultimo || !primero) {
      throw new Error('expected two seeded productos');
    }
    // `ultimo` sorts LAST by producto_id ascending; starve exactly that one.
    await db
      .update(productos)
      .set({ stockActual: 0 })
      .where(eq(productos.id, ultimo.id));

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    // Canary: `ventas_numero_correlativo_seq` is a real Postgres sequence
    // that survives TRUNCATE and this container's whole lifetime, so its
    // absolute value is not portable across runs. A canary sale establishes
    // a known baseline correlativo N; the gap assertion below is relative to
    // it (N+2, not any hardcoded literal).
    const canary = await app.inject({
      method: 'POST',
      url: '/api/ventas',
      payload: {
        items: [
          {
            productoId: productoCanario.id,
            cantidad: 1,
            precioUnitarioEsperado: productoCanario.precio,
          },
        ],
        pagos: [{ medio: 'efectivo', monto: productoCanario.precio }],
      },
      cookies: { sid },
    });
    expect(canary.statusCode).toBe(201);
    const canaryCorrelativo: number = canary.json().venta.numeroCorrelativo;

    const failing = await app.inject({
      method: 'POST',
      url: '/api/ventas',
      payload: {
        items: [
          {
            productoId: primero.id,
            cantidad: 1,
            precioUnitarioEsperado: primero.precio,
          },
          {
            productoId: ultimo.id,
            cantidad: 1,
            precioUnitarioEsperado: ultimo.precio,
          },
        ],
        pagos: [{ medio: 'efectivo', monto: '15.00' }],
      },
      cookies: { sid },
    });

    expect(failing.statusCode).toBe(409);
    expect(failing.json().error.code).toBe('INSUFFICIENT_STOCK');

    // Assert the DATABASE, not just the status code (design.md's rule).
    // `primero` was processed FIRST in Pass B — its aplicarDelta/movimiento
    // must have been rolled back along with everything else.
    expect(await stockActualFor(primero.id)).toBe(primero.stockActual);
    expect(await stockActualFor(ultimo.id)).toBe(0);
    // Only the canary's own row exists in each table — the failed attempt
    // wrote nothing.
    expect(await countRows('ventas')).toBe(1);
    expect(await countRows('items_venta')).toBe(1);
    expect(await countRows('pagos')).toBe(1);
    expect(await countRows('movimientos')).toBe(1);

    // ── Correlativo gap (design.md D7/S6, documented, not a defect) ──
    // The rolled-back attempt above still consumed a `ventas.insert` inside
    // Pass A before Pass B rolled everything back, so `nextval()` was
    // called once and never reused — the NEXT successful sale's
    // numero_correlativo therefore lands at canaryCorrelativo + 2, skipping
    // exactly the value the failed attempt consumed.
    await db
      .update(productos)
      .set({ stockActual: 5 })
      .where(eq(productos.id, ultimo.id));

    const success = await app.inject({
      method: 'POST',
      url: '/api/ventas',
      payload: {
        items: [
          {
            productoId: primero.id,
            cantidad: 1,
            precioUnitarioEsperado: primero.precio,
          },
          {
            productoId: ultimo.id,
            cantidad: 1,
            precioUnitarioEsperado: ultimo.precio,
          },
        ],
        pagos: [{ medio: 'efectivo', monto: '15.00' }],
      },
      cookies: { sid },
    });

    expect(success.statusCode).toBe(201);
    // The gap: exactly one correlativo value (the failed attempt's) was
    // skipped between the canary and this sale — never reissued.
    expect(success.json().venta.numeroCorrelativo).toBe(canaryCorrelativo + 2);
  });

  it('the whole transaction rolls back genuinely — no partial writes survive when a downstream write is forced to fail', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, {
      precio: '10.00',
      stockActual: 10,
    });

    const realUow = createUnitOfWork(db);
    const failingUow: UnitOfWork = {
      run: (work) =>
        realUow.run((repos, tx) =>
          work(
            {
              ...repos,
              ventas: {
                ...repos.ventas,
                createPagos: async () => {
                  throw new Error('forced pagos failure');
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
      url: '/api/ventas',
      payload: {
        items: [
          {
            productoId: producto.id,
            cantidad: 1,
            precioUnitarioEsperado: producto.precio,
          },
        ],
        pagos: [{ medio: 'efectivo', monto: '10.00' }],
      },
      cookies: { sid },
    });

    expect(response.statusCode).toBe(500);
    expect(await stockActualFor(producto.id)).toBe(10);
    expect(await countRows('ventas')).toBe(0);
    expect(await countRows('items_venta')).toBe(0);
    expect(await countRows('movimientos')).toBe(0);
  });
});

describe('ventas schema constraints (integration, real Postgres, direct writes)', () => {
  beforeEach(async () => {
    await db.execute(
      sql`truncate table pagos, items_venta, ventas, movimientos, auditoria, productos, sesiones, proveedores, usuarios cascade`,
    );
  });

  async function seedVentaFixture() {
    const usuario = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, {
      precio: '10.00',
      stockActual: 10,
    });
    const [venta] = await db
      .insert(ventas)
      .values({ usuarioId: usuario.id, total: '10.00' })
      .returning();
    if (!venta) {
      throw new Error('seedVentaFixture: expected a venta row back');
    }
    return { usuario, proveedor, producto, venta };
  }

  it('pagos_vuelto_solo_efectivo rejects a non-zero vuelto on a non-efectivo row (23514)', async () => {
    const { venta } = await seedVentaFixture();

    await expect(
      db.insert(pagos).values({
        ventaId: venta.id,
        medio: 'tarjeta',
        monto: '10.00',
        vuelto: '5.00',
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('pagos_vuelto_solo_efectivo accepts a non-zero vuelto on the efectivo row', async () => {
    const { venta } = await seedVentaFixture();

    await expect(
      db.insert(pagos).values({
        ventaId: venta.id,
        medio: 'efectivo',
        monto: '15.00',
        vuelto: '5.00',
      }),
    ).resolves.not.toThrow();
  });

  it('pagos_venta_id_medio_unique rejects a second payment row for the same medio on the same venta (23505)', async () => {
    const { venta } = await seedVentaFixture();
    await db.insert(pagos).values({
      ventaId: venta.id,
      medio: 'efectivo',
      monto: '5.00',
    });

    await expect(
      db.insert(pagos).values({
        ventaId: venta.id,
        medio: 'efectivo',
        monto: '5.00',
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('items_venta_subtotal_igual_precio_por_cantidad CHECK rejects a mismatched subtotal (23514)', async () => {
    const { venta, producto } = await seedVentaFixture();

    await expect(
      db.insert(itemsVenta).values({
        ventaId: venta.id,
        productoId: producto.id,
        cantidad: 2,
        precioUnitario: '10.00',
        subtotal: '15.00', // should be 20.00
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('items_venta_subtotal_igual_precio_por_cantidad CHECK accepts an exact subtotal', async () => {
    const { venta, producto } = await seedVentaFixture();

    await expect(
      db.insert(itemsVenta).values({
        ventaId: venta.id,
        productoId: producto.id,
        cantidad: 2,
        precioUnitario: '10.00',
        subtotal: '20.00',
      }),
    ).resolves.not.toThrow();
  });
});

// tasks.md 4.2 / design.md D3: the only test that can catch a future
// click-order regression in `ordenarItems`. Two multi-item sales are
// submitted with opposite click order over the SAME two products; if either
// path ever stops sorting before locking rows via aplicarDelta, Postgres
// raises 40P01 (deadlock_detected) instead of serializing the two updates.
describe('concurrent ventas do not deadlock (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table pagos, items_venta, ventas, movimientos, auditoria, productos, sesiones, proveedores, usuarios cascade`,
    );
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('two overlapping multi-item sales in opposite click order both succeed, never raising 40P01', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const productoX = await seedProducto(proveedor.id, {
      nombre: 'Producto X',
      precio: '10.00',
      stockActual: 50,
    });
    const productoY = await seedProducto(proveedor.id, {
      nombre: 'Producto Y',
      precio: '20.00',
      stockActual: 50,
    });

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    // Venta A: clicked X then Y. Venta B: clicked Y then X. Both share the
    // same two products — exactly the scenario D3's ordenarItems exists to
    // serialize safely instead of deadlocking.
    const ventaA = app.inject({
      method: 'POST',
      url: '/api/ventas',
      payload: {
        items: [
          {
            productoId: productoX.id,
            cantidad: 1,
            precioUnitarioEsperado: productoX.precio,
          },
          {
            productoId: productoY.id,
            cantidad: 1,
            precioUnitarioEsperado: productoY.precio,
          },
        ],
        pagos: [{ medio: 'efectivo', monto: '30.00' }],
      },
      cookies: { sid },
    });

    const ventaB = app.inject({
      method: 'POST',
      url: '/api/ventas',
      payload: {
        items: [
          {
            productoId: productoY.id,
            cantidad: 1,
            precioUnitarioEsperado: productoY.precio,
          },
          {
            productoId: productoX.id,
            cantidad: 1,
            precioUnitarioEsperado: productoX.precio,
          },
        ],
        pagos: [{ medio: 'efectivo', monto: '30.00' }],
      },
      cookies: { sid },
    });

    const [responseA, responseB] = await Promise.all([ventaA, ventaB]);

    // Neither request may fail with a raw Postgres deadlock. Any other
    // outcome (both 201, or one 201 and the other refused on a domain
    // ground unrelated to lock order) is acceptable — only 40P01 proves the
    // regression this test exists to catch.
    for (const response of [responseA, responseB]) {
      expect(response.statusCode).not.toBe(500);
      if (response.statusCode >= 500) {
        expect(response.json().error?.code).not.toBe('40P01');
      }
    }
    expect(responseA.statusCode).toBe(201);
    expect(responseB.statusCode).toBe(201);

    expect(await stockActualFor(productoX.id)).toBe(48);
    expect(await stockActualFor(productoY.id)).toBe(48);
  });
});

// backlog #9 (anulacion-venta) tasks.md 5.1/5.2, design.md's Testing
// Strategy row: real Postgres + real createUnitOfWork, overriding only the
// failing dep for the rollback scenario — the atomicity/A8/race properties
// this cycle adds are only provable here, never against fakes.
async function ventaRowFor(id: string) {
  const [row] = await db.select().from(ventas).where(eq(ventas.id, id));
  if (!row) {
    throw new Error('ventaRowFor: venta vanished');
  }
  return row;
}

async function pagosFor(ventaId: string) {
  return db.select().from(pagos).where(eq(pagos.ventaId, ventaId));
}

async function movimientosCountByTipo(ventaId: string, tipo: string) {
  const rows = await db
    .select()
    .from(movimientos)
    .where(eq(movimientos.ventaId, ventaId));
  return rows.filter((r) => r.tipo === tipo).length;
}

describe('POST /api/ventas/:id/anular (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table pagos, items_venta, ventas, movimientos, auditoria, productos, sesiones, proveedores, usuarios cascade`,
    );
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('full atomic reversal on success: stock restored, 2 anulacion movimientos, pago revertido, venta anulada with all 3 fields set, correlativo unchanged', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const productoA = await seedProducto(proveedor.id, {
      nombre: 'Producto A',
      precio: '10.00',
      stockActual: 10,
    });
    const productoB = await seedProducto(proveedor.id, {
      nombre: 'Producto B',
      precio: '5.00',
      stockActual: 20,
    });

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const confirmar = await app.inject({
      method: 'POST',
      url: '/api/ventas',
      payload: {
        items: [
          {
            productoId: productoA.id,
            cantidad: 2,
            precioUnitarioEsperado: productoA.precio,
          },
          {
            productoId: productoB.id,
            cantidad: 3,
            precioUnitarioEsperado: productoB.precio,
          },
        ],
        pagos: [{ medio: 'efectivo', monto: '35.00' }],
      },
      cookies: { sid },
    });
    expect(confirmar.statusCode).toBe(201);
    const ventaId: string = confirmar.json().venta.id;
    const correlativoAntes: number = confirmar.json().venta.numeroCorrelativo;

    expect(await stockActualFor(productoA.id)).toBe(8);
    expect(await stockActualFor(productoB.id)).toBe(17);

    const anular = await app.inject({
      method: 'POST',
      url: `/api/ventas/${ventaId}/anular`,
      payload: { motivoAnulacion: 'Cliente canceló el pedido' },
      cookies: { sid },
    });

    expect(anular.statusCode).toBe(200);
    const body = anular.json();
    expect(body.venta.estado).toBe('anulada');
    expect(body.venta.numeroCorrelativo).toBe(correlativoAntes);

    expect(await stockActualFor(productoA.id)).toBe(10);
    expect(await stockActualFor(productoB.id)).toBe(20);

    expect(await movimientosCountByTipo(ventaId, 'anulacion')).toBe(2);

    const pagosRows = await pagosFor(ventaId);
    expect(pagosRows).toHaveLength(1);
    expect(pagosRows[0]?.estado).toBe('revertido');

    const ventaRow = await ventaRowFor(ventaId);
    expect(ventaRow.estado).toBe('anulada');
    expect(ventaRow.anuladaPor).toBe(encargado.id);
    expect(ventaRow.anuladaEn).toBeInstanceOf(Date);
    expect(ventaRow.motivoAnulacion).toBe('Cliente canceló el pedido');
    expect(ventaRow.numeroCorrelativo).toBe(correlativoAntes);
  });

  it('a now-inactive product (activo = false) still reverses its stock', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, {
      precio: '10.00',
      stockActual: 5,
    });

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const confirmar = await app.inject({
      method: 'POST',
      url: '/api/ventas',
      payload: {
        items: [
          {
            productoId: producto.id,
            cantidad: 2,
            precioUnitarioEsperado: producto.precio,
          },
        ],
        pagos: [{ medio: 'efectivo', monto: '20.00' }],
      },
      cookies: { sid },
    });
    expect(confirmar.statusCode).toBe(201);
    const ventaId: string = confirmar.json().venta.id;
    expect(await stockActualFor(producto.id)).toBe(3);

    await db
      .update(productos)
      .set({ activo: false })
      .where(eq(productos.id, producto.id));

    const anular = await app.inject({
      method: 'POST',
      url: `/api/ventas/${ventaId}/anular`,
      payload: { motivoAnulacion: 'Producto discontinuado, se revierte' },
      cookies: { sid },
    });

    expect(anular.statusCode).toBe(200);
    expect(await stockActualFor(producto.id)).toBe(5);
    const row = await db
      .select({ activo: productos.activo })
      .from(productos)
      .where(eq(productos.id, producto.id));
    expect(row[0]?.activo).toBe(false);
  });

  it('a failure partway through the transaction rolls back everything — no stock/pagos/movimientos/state change, venta stays confirmada', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, {
      precio: '10.00',
      stockActual: 10,
    });

    const confirmApp = await buildApp({ cookieSecret: COOKIE_SECRET });
    await confirmApp.ready();
    const sidConfirm = await loginAs(confirmApp, encargado.email);
    const confirmar = await confirmApp.inject({
      method: 'POST',
      url: '/api/ventas',
      payload: {
        items: [
          {
            productoId: producto.id,
            cantidad: 2,
            precioUnitarioEsperado: producto.precio,
          },
        ],
        pagos: [{ medio: 'efectivo', monto: '20.00' }],
      },
      cookies: { sid: sidConfirm },
    });
    expect(confirmar.statusCode).toBe(201);
    const ventaId: string = confirmar.json().venta.id;
    await confirmApp.close();

    expect(await stockActualFor(producto.id)).toBe(8);

    const realUow = createUnitOfWork(db);
    const failingUow: UnitOfWork = {
      run: (work) =>
        realUow.run((repos, tx) =>
          work(
            {
              ...repos,
              // `DrizzleVentasRepo` methods (createItems, marcarAnulada, ...)
              // live on the prototype, not as instance fields — a plain
              // `{ ...repos.ventas, revertirPagos: ... }` spread copies only
              // own enumerable properties and silently drops all of them,
              // which broke this test at its first repo call instead of at
              // the intended final `revertirPagos` step. Preserve the
              // prototype so every other method still dispatches normally.
              ventas: Object.assign(
                Object.create(Object.getPrototypeOf(repos.ventas)),
                repos.ventas,
                {
                  revertirPagos: async () => {
                    throw new Error('forced pagos-revert failure');
                  },
                },
              ),
            },
            tx,
          ),
        ),
    };

    app = await buildApp({ cookieSecret: COOKIE_SECRET, uow: failingUow });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const anular = await app.inject({
      method: 'POST',
      url: `/api/ventas/${ventaId}/anular`,
      payload: { motivoAnulacion: 'Este intento debe fallar entero' },
      cookies: { sid },
    });

    expect(anular.statusCode).toBe(500);
    expect(await stockActualFor(producto.id)).toBe(8);
    expect(await movimientosCountByTipo(ventaId, 'anulacion')).toBe(0);
    const pagosRows = await pagosFor(ventaId);
    expect(pagosRows[0]?.estado).toBe('registrado');
    const ventaRow = await ventaRowFor(ventaId);
    expect(ventaRow.estado).toBe('confirmada');
    expect(ventaRow.anuladaPor).toBeNull();
    expect(ventaRow.anuladaEn).toBeNull();
    expect(ventaRow.motivoAnulacion).toBeNull();
  });

  it('403 for rol = deposito writes nothing', async () => {
    const deposito = await seedUsuario('deposito');
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, {
      precio: '10.00',
      stockActual: 10,
    });

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sidEncargado = await loginAs(app, encargado.email);
    const confirmar = await app.inject({
      method: 'POST',
      url: '/api/ventas',
      payload: {
        items: [
          {
            productoId: producto.id,
            cantidad: 2,
            precioUnitarioEsperado: producto.precio,
          },
        ],
        pagos: [{ medio: 'efectivo', monto: '20.00' }],
      },
      cookies: { sid: sidEncargado },
    });
    expect(confirmar.statusCode).toBe(201);
    const ventaId: string = confirmar.json().venta.id;
    expect(await stockActualFor(producto.id)).toBe(8);

    const sidDeposito = await loginAs(app, deposito.email);
    const anular = await app.inject({
      method: 'POST',
      url: `/api/ventas/${ventaId}/anular`,
      payload: { motivoAnulacion: 'Intento no autorizado' },
      cookies: { sid: sidDeposito },
    });

    expect(anular.statusCode).toBe(403);
    expect(await stockActualFor(producto.id)).toBe(8);
    expect(await movimientosCountByTipo(ventaId, 'anulacion')).toBe(0);
    const ventaRow = await ventaRowFor(ventaId);
    expect(ventaRow.estado).toBe('confirmada');
    const pagosRows = await pagosFor(ventaId);
    expect(pagosRows[0]?.estado).toBe('registrado');
  });

  // tasks.md 5.2, ADR-0005 precedent (aplicarDelta's conditional-UPDATE race
  // guard, D2's marcarAnulada serialization point).
  it('two concurrent anulación requests on the same confirmada venta — exactly one succeeds, the other gets 409', async () => {
    const encargado = await seedUsuario('encargado');
    const proveedor = await seedProveedor();
    const producto = await seedProducto(proveedor.id, {
      precio: '10.00',
      stockActual: 10,
    });

    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const confirmar = await app.inject({
      method: 'POST',
      url: '/api/ventas',
      payload: {
        items: [
          {
            productoId: producto.id,
            cantidad: 2,
            precioUnitarioEsperado: producto.precio,
          },
        ],
        pagos: [{ medio: 'efectivo', monto: '20.00' }],
      },
      cookies: { sid },
    });
    expect(confirmar.statusCode).toBe(201);
    const ventaId: string = confirmar.json().venta.id;

    const anularA = app.inject({
      method: 'POST',
      url: `/api/ventas/${ventaId}/anular`,
      payload: { motivoAnulacion: 'Primer intento concurrente' },
      cookies: { sid },
    });
    const anularB = app.inject({
      method: 'POST',
      url: `/api/ventas/${ventaId}/anular`,
      payload: { motivoAnulacion: 'Segundo intento concurrente' },
      cookies: { sid },
    });

    const [responseA, responseB] = await Promise.all([anularA, anularB]);
    const statuses = [responseA.statusCode, responseB.statusCode].sort();

    expect(statuses).toEqual([200, 409]);
    const conflictResponse =
      responseA.statusCode === 409 ? responseA : responseB;
    expect(conflictResponse.json().error.code).toBe('SALE_ALREADY_VOIDED');

    // Only ONE reversal took effect — never both.
    expect(await stockActualFor(producto.id)).toBe(10);
    expect(await movimientosCountByTipo(ventaId, 'anulacion')).toBe(1);
    const pagosRows = await pagosFor(ventaId);
    expect(pagosRows[0]?.estado).toBe('revertido');
  });
});
