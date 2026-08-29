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
          usuarioId,
          stockResultante: 0,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });
  });
});
