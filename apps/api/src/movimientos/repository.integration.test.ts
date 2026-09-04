import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from '../db/pool.js';
import { movimientos, productos, proveedores, usuarios } from '../db/schema.js';
import { DrizzleMovimientosRepo, type Movimiento } from './repository.js';

// Real Docker Postgres suite (see vitest.integration.config.ts). Proves two
// properties that only Postgres itself can prove: `create` returns
// `stockResultante` exactly as inserted, never recomputed, and a CHECK
// violation surfaces the raw pg error uncaught — `MovimientosRepo` has no
// domain-error mapping in this change, deliberately asymmetric with
// `ProductosRepo` (tasks.md task 3.1).
const db = getDb();
const repo = new DrizzleMovimientosRepo(db);

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
      nombre: 'Test User',
      email: `movimientos-test-${randomUUID()}@example.com`,
      hashContrasena: 'irrelevant-for-this-test',
      rol: 'deposito',
    })
    .returning();
  if (!row) {
    throw new Error('insertUsuario: expected exactly one row back');
  }
  return row;
}

async function insertProducto(proveedorId: string) {
  const [row] = await db
    .insert(productos)
    .values({
      nombre: `Producto ${randomUUID()}`,
      sku: `SKU-${randomUUID()}`,
      precio: '10.00',
      proveedorId,
    })
    .returning();
  if (!row) {
    throw new Error('insertProducto: expected exactly one row back');
  }
  return row;
}

describe('movimientos repository (integration, real Postgres)', () => {
  let productoId: string;
  let usuarioId: string;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table movimientos, productos, proveedores, usuarios cascade`,
    );
    const proveedor = await insertProveedor();
    productoId = (await insertProducto(proveedor.id)).id;
    usuarioId = (await insertUsuario()).id;
  });

  afterAll(async () => {
    await getPool().end();
  });

  describe('create', () => {
    it('inserts a row and returns stockResultante taken verbatim from the input, never recomputed', async () => {
      const result = await repo.create({
        productoId,
        tipo: 'ajuste',
        cantidad: 5,
        motivo: 'stock inicial (alta de producto)',
        esDiscrepancia: false,
        esMerma: false,
        usuarioId,
        stockResultante: 5,
      });

      expect(result.stockResultante).toBe(5);
      expect(result.tipo).toBe('ajuste');
      expect(result.cantidad).toBe(5);

      const [row] = await db
        .select()
        .from(movimientos)
        .where(eq(movimientos.id, result.id));
      expect(row?.stockResultante).toBe(5);
    });

    it('surfaces the raw Postgres error uncaught on a CHECK violation, with no domain-error mapping', async () => {
      await expect(
        repo.create({
          productoId,
          // entrada requires cantidad > 0 (movimientos_signo_tipo) — this
          // violates it deliberately.
          tipo: 'entrada',
          cantidad: -1,
          motivo: null,
          esDiscrepancia: false,
          esMerma: false,
          usuarioId,
          stockResultante: 0,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });
    it('persists esMerma verbatim', async () => {
      const result = await repo.create({
        productoId,
        tipo: 'salida',
        cantidad: -3,
        motivo: null,
        esDiscrepancia: false,
        esMerma: true,
        usuarioId,
        stockResultante: -3,
      });

      expect(result.esMerma).toBe(true);

      const [row] = await db
        .select()
        .from(movimientos)
        .where(eq(movimientos.id, result.id));
      expect(row?.esMerma).toBe(true);
    });
  });

  describe('listByProducto', () => {
    it('filters and counts by product — total asserted directly, never via rows.length', async () => {
      // Three movements for the fixture product.
      for (let i = 1; i <= 3; i++) {
        await repo.create({
          productoId,
          tipo: 'entrada',
          cantidad: 1,
          motivo: null,
          esDiscrepancia: false,
          esMerma: false,
          usuarioId,
          stockResultante: i,
        });
      }

      // Page 1, pageSize 2 → 2 rows, but total must be 3.
      const result = await repo.listByProducto(productoId, 1, 2);
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(3);
    });

    it('orders by desc(fecha), desc(id) — newest first', async () => {
      const older = new Date('2026-01-01T00:00:00.000Z');
      const newer = new Date('2026-06-01T00:00:00.000Z');

      // Insert older first, then newer — listByProducto must return newer first.
      await db.insert(movimientos).values({
        productoId,
        usuarioId,
        tipo: 'entrada',
        cantidad: 1,
        stockResultante: 1,
        fecha: older,
      });
      await db.insert(movimientos).values({
        productoId,
        usuarioId,
        tipo: 'entrada',
        cantidad: 2,
        stockResultante: 3,
        fecha: newer,
      });

      const result = await repo.listByProducto(productoId, 1, 10);
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(2);
      // Newer first.
      expect(result.rows[0]?.cantidad).toBe(2);
      expect(result.rows[1]?.cantidad).toBe(1);
    });

    it("a second product's movements never leak into the first product's page", async () => {
      // Create a second product under the same proveedor.
      const proveedor = await insertProveedor();
      const otherProductoId = (await insertProducto(proveedor.id)).id;

      // One movement for the fixture product, two for the other.
      await repo.create({
        productoId,
        tipo: 'entrada',
        cantidad: 10,
        motivo: null,
        esDiscrepancia: false,
        esMerma: false,
        usuarioId,
        stockResultante: 10,
      });
      await repo.create({
        productoId: otherProductoId,
        tipo: 'entrada',
        cantidad: 20,
        motivo: null,
        esDiscrepancia: false,
        esMerma: false,
        usuarioId,
        stockResultante: 20,
      });
      await repo.create({
        productoId: otherProductoId,
        tipo: 'entrada',
        cantidad: 30,
        motivo: null,
        esDiscrepancia: false,
        esMerma: false,
        usuarioId,
        stockResultante: 50,
      });

      const result = await repo.listByProducto(productoId, 1, 10);
      expect(result.rows).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.rows[0]?.productoId).toBe(productoId);

      const otherResult = await repo.listByProducto(otherProductoId, 1, 10);
      expect(otherResult.rows).toHaveLength(2);
      expect(otherResult.total).toBe(2);
      for (const row of otherResult.rows) {
        expect(row.productoId).toBe(otherProductoId);
      }
    });
  });

  // design.md D5 — backlog #11. Real Postgres proves the conditional
  // aggregation and the `now()`-relative boundary, neither of which a fake
  // repo could exercise honestly.
  describe('resumenRotacion', () => {
    async function insertMovimiento(overrides: {
      tipo: Movimiento['tipo'];
      cantidad: number;
      stockResultante: number;
      fecha: Date;
    }) {
      await db.insert(movimientos).values({
        productoId,
        usuarioId,
        tipo: overrides.tipo,
        cantidad: overrides.cantidad,
        stockResultante: overrides.stockResultante,
        fecha: overrides.fecha,
      });
    }

    function daysAgo(days: number): Date {
      return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }

    it('sums only venta/salida cantidad (negated) within the last 30 days, excluding entrada/ajuste/anulacion', async () => {
      // Counts: venta and salida, both negative cantidad per CHECK.
      await insertMovimiento({
        tipo: 'venta',
        cantidad: -4,
        stockResultante: 6,
        fecha: daysAgo(1),
      });
      await insertMovimiento({
        tipo: 'salida',
        cantidad: -2,
        stockResultante: 4,
        fecha: daysAgo(2),
      });
      // Excluded regardless of recency.
      await insertMovimiento({
        tipo: 'entrada',
        cantidad: 10,
        stockResultante: 14,
        fecha: daysAgo(1),
      });
      await insertMovimiento({
        tipo: 'ajuste',
        cantidad: -3,
        stockResultante: 11,
        fecha: daysAgo(1),
      });
      await insertMovimiento({
        tipo: 'anulacion',
        cantidad: 4,
        stockResultante: 15,
        fecha: daysAgo(1),
      });

      const resumen = await repo.resumenRotacion(productoId);

      expect(resumen.unidadesSalida30d).toBe(6);
    });

    it('counts a movimiento at day 29 but excludes one older than 30 days (boundary)', async () => {
      await insertMovimiento({
        tipo: 'venta',
        cantidad: -5,
        stockResultante: 10,
        fecha: daysAgo(29),
      });
      await insertMovimiento({
        tipo: 'venta',
        cantidad: -7,
        stockResultante: 3,
        fecha: daysAgo(31),
      });

      const resumen = await repo.resumenRotacion(productoId);

      expect(resumen.unidadesSalida30d).toBe(5);
    });

    it('includes a movimiento at exactly the 30-day boundary (inclusive `>=`)', async () => {
      // `now()` is stable for every statement inside the same Postgres
      // transaction (transaction_timestamp semantics), so computing `fecha`
      // as `now() - interval '30 days'` in the same transaction the query
      // later runs in lands exactly on the boundary the production SQL
      // checks — a JS-computed Date can never hit that exact instant.
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          insert into movimientos (producto_id, usuario_id, tipo, cantidad, stock_resultante, fecha)
          values (${productoId}, ${usuarioId}, 'venta', -8, 2, now() - interval '30 days')
        `);
        const txRepo = new DrizzleMovimientosRepo(tx);
        const resumen = await txRepo.resumenRotacion(productoId);
        expect(resumen.unidadesSalida30d).toBe(8);
      });
    });

    it('computes diasHistoria as whole days since MIN(fecha) across ALL movimientos, unbounded by the 30-day window', async () => {
      // Oldest movimiento is well outside the 30-day window; diasHistoria
      // must still reflect it, not be clamped to 30.
      await insertMovimiento({
        tipo: 'entrada',
        cantidad: 20,
        stockResultante: 20,
        fecha: daysAgo(45),
      });
      await insertMovimiento({
        tipo: 'venta',
        cantidad: -1,
        stockResultante: 19,
        fecha: daysAgo(1),
      });

      const resumen = await repo.resumenRotacion(productoId);

      expect(resumen.diasHistoria).toBe(45);
    });

    it('returns diasHistoria = 0, never NULL/NaN, for a producto with exactly one just-inserted movimiento', async () => {
      await repo.create({
        productoId,
        tipo: 'ajuste',
        cantidad: 5,
        motivo: 'stock inicial (alta de producto)',
        esDiscrepancia: false,
        esMerma: false,
        usuarioId,
        stockResultante: 5,
      });

      const resumen = await repo.resumenRotacion(productoId);

      expect(resumen.diasHistoria).toBe(0);
      expect(Number.isNaN(resumen.diasHistoria)).toBe(false);
      expect(resumen.unidadesSalida30d).toBe(0);
    });
  });

  // design.md D2 — backlog #12. Real Postgres proves the half-open
  // `[fechaDesde, fechaHastaExclusiva)` boundary and cross-actor visibility,
  // neither of which a fake repo could exercise honestly.
  describe('listByPeriodo', () => {
    let otherUsuarioId: string;

    beforeEach(async () => {
      otherUsuarioId = (await insertUsuario()).id;
    });

    async function insertMovimiento(overrides: {
      usuarioId: string;
      fecha: Date;
      cantidad?: number;
      stockResultante?: number;
    }) {
      await db.insert(movimientos).values({
        productoId,
        usuarioId: overrides.usuarioId,
        tipo: 'entrada',
        cantidad: overrides.cantidad ?? 1,
        stockResultante: overrides.stockResultante ?? 1,
        fecha: overrides.fecha,
      });
    }

    it('returns movimientos from all actors within [fechaDesde, fechaHastaExclusiva)', async () => {
      const fechaDesde = new Date('2026-02-01T00:00:00.000Z');
      const fechaHastaExclusiva = new Date('2026-03-01T00:00:00.000Z');

      // In range, actor A.
      await insertMovimiento({
        usuarioId,
        fecha: new Date('2026-02-15T00:00:00.000Z'),
      });
      // In range, actor B — must still be visible with no usuarioId filter.
      await insertMovimiento({
        usuarioId: otherUsuarioId,
        fecha: new Date('2026-02-20T00:00:00.000Z'),
      });
      // Before range — excluded.
      await insertMovimiento({
        usuarioId,
        fecha: new Date('2026-01-31T23:59:59.999Z'),
      });
      // Exactly at fechaHastaExclusiva — excluded (half-open, upper bound).
      await insertMovimiento({
        usuarioId,
        fecha: fechaHastaExclusiva,
      });
      // Exactly at fechaDesde — included (half-open, lower bound inclusive).
      await insertMovimiento({
        usuarioId,
        fecha: fechaDesde,
      });

      const result = await repo.listByPeriodo(
        { fechaDesde, fechaHastaExclusiva },
        1,
        10,
      );

      expect(result.total).toBe(3);
      expect(result.rows).toHaveLength(3);
      const usuarioIds = result.rows.map((row) => row.usuarioId).sort();
      expect(usuarioIds).toEqual([otherUsuarioId, usuarioId, usuarioId].sort());
    });

    it('restricts rows to the given usuarioId when the optional filter is present', async () => {
      const fechaDesde = new Date('2026-02-01T00:00:00.000Z');
      const fechaHastaExclusiva = new Date('2026-03-01T00:00:00.000Z');

      await insertMovimiento({
        usuarioId,
        fecha: new Date('2026-02-10T00:00:00.000Z'),
      });
      await insertMovimiento({
        usuarioId: otherUsuarioId,
        fecha: new Date('2026-02-12T00:00:00.000Z'),
      });

      const result = await repo.listByPeriodo(
        { fechaDesde, fechaHastaExclusiva, usuarioId },
        1,
        10,
      );

      expect(result.total).toBe(1);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.usuarioId).toBe(usuarioId);
    });

    it('applies the same predicate (date range + optional actor) to the page and count query', async () => {
      const fechaDesde = new Date('2026-02-01T00:00:00.000Z');
      const fechaHastaExclusiva = new Date('2026-03-01T00:00:00.000Z');

      for (let i = 1; i <= 3; i++) {
        await insertMovimiento({
          usuarioId,
          fecha: new Date(`2026-02-0${i}T00:00:00.000Z`),
        });
      }
      // A different actor's movimiento, same range — must not count when
      // usuarioId filter is present.
      await insertMovimiento({
        usuarioId: otherUsuarioId,
        fecha: new Date('2026-02-05T00:00:00.000Z'),
      });

      const result = await repo.listByPeriodo(
        { fechaDesde, fechaHastaExclusiva, usuarioId },
        1,
        2,
      );

      // Page 1, pageSize 2 → 2 rows, but total must still be 3 (not 4).
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(3);
    });

    it('orders by desc(fecha), desc(id) — newest first', async () => {
      const fechaDesde = new Date('2026-02-01T00:00:00.000Z');
      const fechaHastaExclusiva = new Date('2026-03-01T00:00:00.000Z');
      const older = new Date('2026-02-05T00:00:00.000Z');
      const newer = new Date('2026-02-20T00:00:00.000Z');

      await insertMovimiento({ usuarioId, fecha: older, cantidad: 1 });
      await insertMovimiento({ usuarioId, fecha: newer, cantidad: 2 });

      const result = await repo.listByPeriodo(
        { fechaDesde, fechaHastaExclusiva },
        1,
        10,
      );

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]?.cantidad).toBe(2);
      expect(result.rows[1]?.cantidad).toBe(1);
    });

    it('returns { rows: [], total: 0 } for an empty range, not an error', async () => {
      await insertMovimiento({
        usuarioId,
        fecha: new Date('2026-02-10T00:00:00.000Z'),
      });

      const result = await repo.listByPeriodo(
        {
          fechaDesde: new Date('2027-01-01T00:00:00.000Z'),
          fechaHastaExclusiva: new Date('2027-02-01T00:00:00.000Z'),
        },
        1,
        10,
      );

      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
