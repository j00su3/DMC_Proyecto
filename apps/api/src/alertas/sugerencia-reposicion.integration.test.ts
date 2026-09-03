import { randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from '../db/pool.js';
import {
  alertas,
  movimientos,
  productos,
  proveedores,
  usuarios,
} from '../db/schema.js';
import { createUnitOfWork } from '../db/uow.js';
import { registrarMovimiento } from '../movimientos/service.js';
import { buildRepos } from '../plugins/repos.js';
import { crearProducto } from '../productos/service.js';
import { anularVenta, confirmarVenta } from '../ventas/service.js';

// design.md D6/D7 (backlog #11). Real Postgres proves the exact call-site
// wiring per spec.md's "Sugerencia De Reposición Evaluated Only At Specific
// Call Sites": movimientos/service.ts::registrarMovimiento,
// productos/service.ts::crearProducto, ventas/service.ts::confirmarVenta all
// evaluate the rule; ventas/service.ts::anularVenta does not (D3). Per
// tasks.md task 2.6, none of those four files needed ANY production-code
// change — structural typing already routes the full Movimiento/Repos shape
// into the widened EvaluadorMovimiento/EvaluadorRepos interfaces.
const db = getDb();
const repos = buildRepos(db);

async function insertProveedor() {
  const [row] = await db
    .insert(proveedores)
    .values({ nombre: `Proveedor ${randomUUID()}` })
    .returning();
  if (!row) {
    throw new Error('insertProveedor: expected exactly one row back');
  }
  return row;
}

async function insertUsuario() {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre: 'S7 Test User',
      email: `sugerencia-reposicion-${randomUUID()}@example.com`,
      hashContrasena: 'irrelevant-for-this-test',
      rol: 'encargado' as const,
    })
    .returning();
  if (!row) {
    throw new Error('insertUsuario: expected exactly one row back');
  }
  return row;
}

async function insertProducto(
  proveedorId: string,
  over: { stockMinimo?: number | null; stockActual?: number } = {},
) {
  const [row] = await db
    .insert(productos)
    .values({
      nombre: `Producto ${randomUUID()}`,
      sku: `SKU-${randomUUID()}`,
      precio: '10.00',
      proveedorId,
      stockMinimo: over.stockMinimo ?? null,
    })
    .returning();
  if (!row) {
    throw new Error('insertProducto: expected exactly one row back');
  }
  if (over.stockActual !== undefined) {
    await db
      .update(productos)
      .set({ stockActual: over.stockActual })
      .where(eq(productos.id, row.id));
    return { ...row, stockActual: over.stockActual };
  }
  return row;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Seeds a historical venta movimiento so the producto has >=7 days of
// history AND a non-zero promedioDiario before the call site under test
// runs — otherwise the S7 heuristic's own `diasHistoria >= 7` gate always
// skips evaluation (design.md D5/D4).
async function seedHistoria(
  productoId: string,
  usuarioId: string,
  unidades: number,
  hace: number,
) {
  await db.insert(movimientos).values({
    productoId,
    usuarioId,
    tipo: 'venta',
    cantidad: -unidades,
    stockResultante: 0,
    fecha: daysAgo(hace),
  });
}

async function sugerenciaAlertasFor(productoId: string) {
  return db
    .select()
    .from(alertas)
    .where(
      and(
        eq(alertas.productoId, productoId),
        eq(alertas.tipo, 'sugerencia_reposicion'),
      ),
    );
}

async function abiertasSugerenciaFor(productoId: string) {
  return db
    .select()
    .from(alertas)
    .where(
      and(
        eq(alertas.productoId, productoId),
        eq(alertas.tipo, 'sugerencia_reposicion'),
        ne(alertas.estado, 'resuelta'),
      ),
    );
}

afterAll(async () => {
  await getPool().end();
});

describe('sugerencia_reposicion — call-site wiring (integration, real Postgres, design.md D3/D6/D7)', () => {
  beforeEach(async () => {
    await db.execute(
      sql`truncate table alertas, movimientos, productos, proveedores, usuarios cascade`,
    );
  });

  it('movimientos/service.ts::registrarMovimiento produces exactly one open sugerencia_reposicion alert when coverage crosses below 14 days', async () => {
    const proveedor = await insertProveedor();
    const usuario = await insertUsuario();
    const producto = await insertProducto(proveedor.id, { stockActual: 500 });

    // 200 units sold 10 days ago -> diasHistoria=10, divisor=10.
    await seedHistoria(producto.id, usuario.id, 200, 10);

    const uow = createUnitOfWork(db);
    // 450 units sold now: unidadesSalida30d = 200 + 450 = 650, divisor 10 ->
    // promedioDiario = 65; stockResultante = 50 -> coberturaDias ≈ 0.77 < 14.
    await registrarMovimiento(uow, {
      productoId: producto.id,
      operacion: 'salida',
      cantidad: 450,
      esMerma: false,
      esDiscrepancia: false,
      actor: { id: usuario.id, rol: 'encargado' },
    });

    const rows = await sugerenciaAlertasFor(producto.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.estado).toBe('activa');
  });

  it('productos/service.ts::crearProducto (stockInicial > 0) never produces a sugerencia_reposicion alert — a brand-new producto always has diasHistoria = 0 (design.md D5)', async () => {
    const proveedor = await insertProveedor();
    const usuario = await insertUsuario();

    const uow = createUnitOfWork(db);
    // stockInicial deliberately tiny relative to zero history: if the >=7
    // days gate were ever bypassed this would obviously cross <14 days
    // coverage. It never does, because the producto's own creation
    // movimiento IS its first-ever movimiento — MIN(fecha) equals the same
    // transaction's `now()`, so diasHistoria is always exactly 0 here.
    const creado = await crearProducto(repos, uow, {
      nombre: `Producto ${randomUUID()}`,
      sku: `SKU-${randomUUID()}`,
      precio: '10.00',
      proveedorId: proveedor.id,
      stockInicial: 1,
      actor: { id: usuario.id, rol: 'encargado' },
    });

    const rows = await sugerenciaAlertasFor(creado.id);
    expect(rows).toHaveLength(0);
  });

  it('ventas/service.ts::confirmarVenta produces exactly one open sugerencia_reposicion alert when an item crosses below 14 days coverage', async () => {
    const proveedor = await insertProveedor();
    const usuario = await insertUsuario();
    const producto = await insertProducto(proveedor.id, { stockActual: 1000 });

    // 700 units sold 10 days ago -> diasHistoria=10, divisor=10.
    await seedHistoria(producto.id, usuario.id, 700, 10);

    const uow = createUnitOfWork(db);
    // Sell 900: unidadesSalida30d = 700 + 900 = 1600, promedioDiario = 160;
    // stockResultante = 100 -> coberturaDias = 0.625 < 14.
    await confirmarVenta(uow, {
      items: [
        {
          productoId: producto.id,
          cantidad: 900,
          precioUnitarioEsperado: '10.00',
        },
      ],
      pagos: [{ medio: 'efectivo', monto: '9000.00' }],
      actor: { id: usuario.id, rol: 'encargado' },
    });

    const rows = await sugerenciaAlertasFor(producto.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.estado).toBe('activa');
  });

  it('ventas/service.ts::anularVenta produces no sugerencia_reposicion alert even when its own resulting coverage would otherwise cross below 14 days (D3)', async () => {
    const proveedor = await insertProveedor();
    const usuario = await insertUsuario();
    const producto = await insertProducto(proveedor.id, { stockActual: 1000 });

    // Same high-rate setup as the confirmarVenta case above.
    await seedHistoria(producto.id, usuario.id, 700, 10);

    const uow = createUnitOfWork(db);
    const venta = await confirmarVenta(uow, {
      items: [
        {
          productoId: producto.id,
          cantidad: 900,
          precioUnitarioEsperado: '10.00',
        },
      ],
      pagos: [{ medio: 'efectivo', monto: '9000.00' }],
      actor: { id: usuario.id, rol: 'encargado' },
    });

    // The sale itself DID cross the threshold (proven above) — one open
    // alert exists. Manually resolve it so the D4 dedup index no longer
    // blocks a fresh insert; this isolates the assertion to D3's guard
    // rather than piggy-backing on dedup for the "no new row" result.
    await db
      .update(alertas)
      .set({
        estado: 'resuelta',
        resueltaEn: new Date(),
        resueltaPor: usuario.id,
      })
      .where(
        and(
          eq(alertas.productoId, producto.id),
          eq(alertas.tipo, 'sugerencia_reposicion'),
        ),
      );

    // Reverse the sale: stockResultante goes from 100 back to 1000.
    // unidadesSalida30d is UNCHANGED by an 'anulacion' movimiento (only
    // venta/salida count, D5) — still 1600, promedioDiario 160 — so
    // coberturaDias = 1000 / 160 = 6.25, still < 14. If D3's guard were
    // absent, this WOULD create a fresh (non-deduped) alert row.
    await anularVenta(uow, {
      ventaId: venta.venta.id,
      actorId: usuario.id,
      motivoAnulacion: 'prueba de exclusion D3',
    });

    const abiertas = await abiertasSugerenciaFor(producto.id);
    expect(abiertas).toHaveLength(0);
  });
});

describe('sugerencia_reposicion — dedup generalizes to a fourth tipo (integration, real Postgres, task 2.7)', () => {
  beforeEach(async () => {
    await db.execute(
      sql`truncate table alertas, movimientos, productos, proveedores, usuarios cascade`,
    );
  });

  it('re-evaluating an already-activa sugerencia_reposicion alert while still under-threshold creates no second row', async () => {
    const proveedor = await insertProveedor();
    const usuario = await insertUsuario();
    const producto = await insertProducto(proveedor.id, { stockActual: 500 });

    await seedHistoria(producto.id, usuario.id, 200, 10);

    const uow = createUnitOfWork(db);
    // First movement crosses below 14 days coverage -> creates the alert.
    await registrarMovimiento(uow, {
      productoId: producto.id,
      operacion: 'salida',
      cantidad: 450,
      esMerma: false,
      esDiscrepancia: false,
      actor: { id: usuario.id, rol: 'encargado' },
    });

    const afterFirst = await sugerenciaAlertasFor(producto.id);
    expect(afterFirst).toHaveLength(1);

    // Second, small movement: still crosses the same rule (still deep under
    // 14 days coverage) — the existing D4 partial unique index must dedup
    // this into zero new rows, exactly as it already does for the other
    // three tipos.
    await registrarMovimiento(uow, {
      productoId: producto.id,
      operacion: 'entrada',
      cantidad: 1,
      esMerma: false,
      esDiscrepancia: false,
      actor: { id: usuario.id, rol: 'encargado' },
    });

    const afterSecond = await sugerenciaAlertasFor(producto.id);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]?.id).toBe(afterFirst[0]?.id);
  });
});
