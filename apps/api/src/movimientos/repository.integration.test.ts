import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from '../db/pool.js';
import { movimientos, productos, proveedores, usuarios } from '../db/schema.js';
import { DrizzleMovimientosRepo } from './repository.js';

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
});
