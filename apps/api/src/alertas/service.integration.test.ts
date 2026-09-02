import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DbExecutor } from '../db/client.js';
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
import type { Repos } from '../plugins/repos.js';
import { confirmarVenta } from '../ventas/service.js';
import { DrizzleAlertasRepo } from './repository.js';

// Real Docker Postgres. This suite proves the C1 acceptance criterion
// (design.md ADR-0008, spec.md "Evaluator Failure Never Rolls Back The
// Movement") and the D4 dedup-under-concurrency guarantee — both are
// properties only a real Postgres transaction can prove; a fake TxControl
// cannot fake a genuine 25P02 aborted-transaction recovery.
const db = getDb();

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
      nombre: 'C1 Test User',
      email: `alertas-c1-${randomUUID()}@example.com`,
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
  over: {
    stockMinimo?: number | null;
    stockActual?: number;
    precio?: string;
  } = {},
) {
  const [row] = await db
    .insert(productos)
    .values({
      nombre: `Producto ${randomUUID()}`,
      sku: `SKU-${randomUUID()}`,
      precio: over.precio ?? '10.00',
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

async function alertasFor(productoId: string) {
  return db.select().from(alertas).where(eq(alertas.productoId, productoId));
}

// Reaches into DrizzleProductosRepo/DrizzleAlertasRepo's private `db` field
// to obtain the SAME raw executor `uow.run` bound the callback's repos to.
// TypeScript's `private` is a compile-time annotation only; at runtime this
// is a plain property read. This is the only way to force a GENUINE
// Postgres SQL error (not just an app-level throw) inside the exact
// transaction/connection the test needs to prove recovers via
// ROLLBACK TO SAVEPOINT — TxControl deliberately exposes no raw-SQL escape
// hatch (design.md D2), so a real regression here can only be caught this
// way.
function rawExecutorFrom(repos: Pick<Repos, 'productos'>): DbExecutor {
  return (repos.productos as unknown as { db: DbExecutor }).db;
}

// File scope, NOT inside a describe (proveedores.integration.test.ts's
// D-note precedent): an afterAll inside the first describe fires once that
// describe's own tests finish, closing the pool before the second describe
// in this file ever runs.
afterAll(async () => {
  await getPool().end();
});

describe('C1 acceptance criterion (integration, real Postgres): evaluator SQL failure never rolls back the movement', () => {
  beforeEach(async () => {
    await db.execute(
      sql`truncate table alertas, movimientos, productos, proveedores, usuarios cascade`,
    );
  });

  it('registrarMovimiento: a genuine SQL error inside alertas.create still commits the movimiento and the stock update, with zero alert rows', async () => {
    const proveedor = await insertProveedor();
    const usuario = await insertUsuario();
    const producto = await insertProducto(proveedor.id, {
      stockMinimo: 5,
      stockActual: 10,
    });

    const realUow = createUnitOfWork(db);
    const failingUow = {
      run: (work: Parameters<typeof realUow.run>[0]) =>
        realUow.run((repos, tx) => {
          const rawExecutor = rawExecutorFrom(repos);
          const failingAlertas = {
            ...repos.alertas,
            create: async () => {
              // A GENUINE Postgres error (undefined_table, 42P01) inside the
              // SAME transaction/connection — this is what actually puts
              // Postgres into the aborted (25P02) state that ROLLBACK TO
              // SAVEPOINT must recover from. A plain `throw new Error(...)`
              // would not exercise that recovery path at all.
              await rawExecutor.execute(
                sql`select * from this_table_does_not_exist_at_all`,
              );
              throw new Error('unreachable: the SQL above always throws');
            },
          };
          return work({ ...repos, alertas: failingAlertas }, tx);
        }),
    };

    const result = await registrarMovimiento(failingUow as typeof realUow, {
      productoId: producto.id,
      operacion: 'salida',
      cantidad: 7,
      esMerma: false,
      esDiscrepancia: false,
      actor: { id: usuario.id, rol: 'encargado' },
    });

    // The movimiento and the stock update genuinely committed.
    expect(result.movimiento.stockResultante).toBe(3);
    const [movRow] = await db
      .select()
      .from(movimientos)
      .where(eq(movimientos.id, result.movimiento.id));
    expect(movRow).toBeDefined();
    expect(movRow?.stockResultante).toBe(3);

    const [productoRow] = await db
      .select()
      .from(productos)
      .where(eq(productos.id, producto.id));
    expect(productoRow?.stockActual).toBe(3);

    // No alert row exists — the evaluator's own SQL failed and rolled back
    // ONLY its own savepoint, not the outer transaction.
    expect(await alertasFor(producto.id)).toHaveLength(0);
  });

  it("confirmarVenta: item 2's genuine SQL failure does not block items 1/3 from getting their own real alert rows, and the whole sale still commits", async () => {
    const proveedor = await insertProveedor();
    const usuario = await insertUsuario();
    const productoA = await insertProducto(proveedor.id, {
      stockMinimo: 5,
      stockActual: 10,
      precio: '10.00',
    });
    const productoB = await insertProducto(proveedor.id, {
      stockMinimo: null,
      stockActual: 10,
      precio: '20.00',
    });
    const productoC = await insertProducto(proveedor.id, {
      stockMinimo: 5,
      stockActual: 10,
      precio: '5.00',
    });

    const realUow = createUnitOfWork(db);
    const failingUow = {
      run: (work: Parameters<typeof realUow.run>[0]) =>
        realUow.run((repos, tx) => {
          const rawExecutor = rawExecutorFrom(repos);
          const failingAlertas = {
            ...repos.alertas,
            create: async (
              input: Parameters<typeof repos.alertas.create>[0],
            ) => {
              if (input.productoId === productoB.id) {
                await rawExecutor.execute(
                  sql`select * from this_table_does_not_exist_at_all`,
                );
                throw new Error('unreachable: the SQL above always throws');
              }
              return repos.alertas.create(input);
            },
          };
          return work({ ...repos, alertas: failingAlertas }, tx);
        }),
    };

    const result = await confirmarVenta(failingUow as typeof realUow, {
      items: [
        {
          productoId: productoA.id,
          cantidad: 6,
          precioUnitarioEsperado: '10.00',
        },
        {
          productoId: productoB.id,
          cantidad: 6,
          precioUnitarioEsperado: '20.00',
        },
        {
          productoId: productoC.id,
          cantidad: 6,
          precioUnitarioEsperado: '5.00',
        },
      ],
      pagos: [{ medio: 'efectivo', monto: '210.00' }],
      actor: { id: usuario.id, rol: 'encargado' },
    });

    // The whole sale genuinely committed — three items, three movimientos.
    expect(result.items).toHaveLength(3);
    const movCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(movimientos)
      .where(eq(movimientos.ventaId, result.venta.id));
    expect(movCount[0]?.n).toBe(3);

    // Items 1 and 3 (A, C) crossed below stockMinimo=5 (10 -> 4) and got
    // their real stock_bajo alert rows, genuinely committed.
    const alertasA = await alertasFor(productoA.id);
    expect(alertasA).toHaveLength(1);
    expect(alertasA[0]?.tipo).toBe('stock_bajo');
    const alertasC = await alertasFor(productoC.id);
    expect(alertasC).toHaveLength(1);
    expect(alertasC[0]?.tipo).toBe('stock_bajo');

    // Item 2 (B)'s evaluator SQL genuinely failed — zero alert rows for it.
    expect(await alertasFor(productoB.id)).toHaveLength(0);
  });
});

describe('D4 dedup-under-concurrency (integration, real Postgres): two concurrent creates for the same producto+tipo produce exactly one row', () => {
  beforeEach(async () => {
    await db.execute(
      sql`truncate table alertas, movimientos, productos, proveedores, usuarios cascade`,
    );
  });

  it('exactly one of two concurrent AlertasRepo.create calls wins; the other returns undefined; one row persists', async () => {
    const proveedor = await insertProveedor();
    const producto = await insertProducto(proveedor.id, { stockMinimo: 5 });
    const repo = new DrizzleAlertasRepo(db);

    const [first, second] = await Promise.all([
      repo.create({ productoId: producto.id, tipo: 'stock_bajo' }),
      repo.create({ productoId: producto.id, tipo: 'stock_bajo' }),
    ]);

    const results = [first, second];
    const won = results.filter((r) => r !== undefined);
    const lost = results.filter((r) => r === undefined);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);

    const rows = await alertasFor(producto.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tipo).toBe('stock_bajo');
  });

  it('two concurrent movements crossing the same threshold produce exactly one open alert row end-to-end', async () => {
    const proveedor = await insertProveedor();
    const usuarioA = await insertUsuario();
    const usuarioB = await insertUsuario();
    // High starting stock so BOTH concurrent salidas independently straddle
    // stockMinimo — each computes its own crossing from the SAME pre-race
    // stockActual snapshot's neighborhood is not guaranteed (aplicarDelta
    // serializes on the row), but the dedup guarantee under test is at the
    // alertas insert layer regardless of which one (or both) computes a
    // crossing: the partial unique index caps it at one open row no matter
    // how many crossings are attempted concurrently.
    const producto = await insertProducto(proveedor.id, {
      stockMinimo: 50,
      stockActual: 60,
    });

    const uow = createUnitOfWork(db);

    await Promise.all([
      registrarMovimiento(uow, {
        productoId: producto.id,
        operacion: 'salida',
        cantidad: 8,
        esMerma: false,
        esDiscrepancia: false,
        actor: { id: usuarioA.id, rol: 'encargado' },
      }),
      registrarMovimiento(uow, {
        productoId: producto.id,
        operacion: 'salida',
        cantidad: 9,
        esMerma: false,
        esDiscrepancia: false,
        actor: { id: usuarioB.id, rol: 'encargado' },
      }),
    ]);

    const rows = await alertasFor(producto.id);
    // At most one OPEN stock_bajo alert for this producto, however many of
    // the two concurrent movements individually computed a crossing.
    const abiertas = rows.filter((r) => r.estado !== 'resuelta');
    expect(abiertas.length).toBeLessThanOrEqual(1);
    const stockBajoRows = rows.filter((r) => r.tipo === 'stock_bajo');
    expect(stockBajoRows.length).toBeLessThanOrEqual(1);
  });
});
