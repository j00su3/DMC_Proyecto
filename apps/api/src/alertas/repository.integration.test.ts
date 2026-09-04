import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from '../db/pool.js';
import { productos, proveedores } from '../db/schema.js';
import { DrizzleAlertasRepo } from './repository.js';

// Real Docker Postgres. Proves `countAbiertasPorTipo`'s composed predicate
// (design.md D2's correction, backlog #13) against real rows — a fake db
// mock only proves the predicate object shape, not that Postgres evaluates
// it as intended.
const db = getDb();
const repo = new DrizzleAlertasRepo(db);

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

describe('alertas repository (integration, real Postgres)', () => {
  let proveedorId: string;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table alertas, movimientos, productos, proveedores cascade`,
    );
    proveedorId = (await insertProveedor()).id;
  });

  afterAll(async () => {
    await getPool().end();
  });

  describe('countAbiertasPorTipo', () => {
    it('counts only estado <> resuelta rows matching the given tipo', async () => {
      const p1 = (await insertProducto(proveedorId)).id;
      const p2 = (await insertProducto(proveedorId)).id;
      const p3 = (await insertProducto(proveedorId)).id;
      const p4 = (await insertProducto(proveedorId)).id;

      // 2 open quiebre, 3 open stock_bajo, 1 open discrepancia.
      await repo.create({ productoId: p1, tipo: 'quiebre' });
      await repo.create({ productoId: p2, tipo: 'quiebre' });
      await repo.create({ productoId: p3, tipo: 'stock_bajo' });
      await repo.create({ productoId: p4, tipo: 'discrepancia' });

      expect(await repo.countAbiertasPorTipo('quiebre')).toBe(2);
      expect(await repo.countAbiertasPorTipo('stock_bajo')).toBe(1);
      expect(await repo.countAbiertasPorTipo('discrepancia')).toBe(1);
    });

    it('excludes resuelta rows of the matching tipo', async () => {
      const p1 = (await insertProducto(proveedorId)).id;
      const alerta = await repo.create({ productoId: p1, tipo: 'quiebre' });
      if (!alerta) throw new Error('expected alerta to be created');
      await repo.autoResolve(p1, 'quiebre');

      expect(await repo.countAbiertasPorTipo('quiebre')).toBe(0);
    });

    it('returns 0, not undefined, when no open alerts of that tipo exist', async () => {
      expect(await repo.countAbiertasPorTipo('sugerencia_reposicion')).toBe(0);
    });
  });
});
