import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from '../db/pool.js';
import { productos, proveedores } from '../db/schema.js';
import { DrizzleProductosRepo } from './repository.js';
import type { CambiosProducto } from './repository.js';

// Real Docker Postgres suite (see vitest.integration.config.ts). Proves
// properties that are properties of SQL, not of the fake pool: the D7
// count-query trap (a filter applied to only one of the two statements
// passes a data.length assertion and reports a wrong total), pattern
// escaping for `%`/`_`/`\`, the D13-style 23505 -> SKU_ALREADY_IN_USE
// mapping, and D1's single conditional UPDATE serializing concurrent
// aplicarDelta calls on the row itself.
const db = getDb();
const repo = new DrizzleProductosRepo(db);

async function insertProveedor(
  overrides: Partial<{ nombre: string; activo: boolean }> = {},
) {
  const [row] = await db
    .insert(proveedores)
    .values({
      nombre: overrides.nombre ?? `Proveedor ${randomUUID()}`,
      ...(overrides.activo !== undefined ? { activo: overrides.activo } : {}),
    })
    .returning();
  if (!row) {
    throw new Error('insertProveedor: expected exactly one row back');
  }
  return row;
}

async function insertProducto(
  proveedorId: string,
  overrides: Partial<{
    id: string;
    nombre: string;
    sku: string;
    categoria: string | null;
    stockActual: number;
    stockMinimo: number | null;
    precio: string;
    activo: boolean;
    creadoEn: Date;
  }> = {},
) {
  const [row] = await db
    .insert(productos)
    .values({
      ...(overrides.id ? { id: overrides.id } : {}),
      nombre: overrides.nombre ?? `Producto ${randomUUID()}`,
      sku: overrides.sku ?? `SKU-${randomUUID()}`,
      categoria: overrides.categoria ?? null,
      ...(overrides.stockActual !== undefined
        ? { stockActual: overrides.stockActual }
        : {}),
      stockMinimo: overrides.stockMinimo ?? null,
      precio: overrides.precio ?? '10.00',
      proveedorId,
      ...(overrides.activo !== undefined ? { activo: overrides.activo } : {}),
      ...(overrides.creadoEn ? { creadoEn: overrides.creadoEn } : {}),
    })
    .returning();
  if (!row) {
    throw new Error('insertProducto: expected exactly one row back');
  }
  return row;
}

describe('productos repository (integration, real Postgres)', () => {
  let proveedorId: string;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table movimientos, productos, proveedores cascade`,
    );
    proveedorId = (await insertProveedor()).id;
  });

  afterAll(async () => {
    await getPool().end();
  });

  describe('list — pagination', () => {
    it('reports the real total on an out-of-range page instead of 0', async () => {
      await insertProducto(proveedorId);
      await insertProducto(proveedorId);

      const result = await repo.list(5, 20);

      expect(result.rows).toHaveLength(0);
      expect(result.total).toBe(2);
    });
  });

  describe('list — search (D7 count-query trap)', () => {
    it('filters on nombre and sku case-insensitively, and the count reflects the same filter', async () => {
      await insertProducto(proveedorId, {
        nombre: 'Tornillo Phillips',
        sku: 'TP-001',
      });
      await insertProducto(proveedorId, {
        nombre: 'Tornillo Allen',
        sku: 'TA-002',
      });
      await insertProducto(proveedorId, {
        nombre: 'Destornillador',
        sku: 'DEST-01',
      });

      const byName = await repo.list(1, 10, 'tornillo');
      expect(byName.rows.length).toBe(2);
      expect(byName.total).toBe(2);

      const bySku = await repo.list(1, 10, 'dest');
      expect(bySku.rows.length).toBe(1);
      expect(bySku.total).toBe(1);
    });

    it('reports the correct total even when the page only shows one row (the D7 trap itself)', async () => {
      await insertProducto(proveedorId, {
        nombre: 'Tornillo Phillips',
        sku: 'TP-001',
      });
      await insertProducto(proveedorId, {
        nombre: 'Tornillo Allen',
        sku: 'TA-002',
      });
      await insertProducto(proveedorId, {
        nombre: 'Destornillador',
        sku: 'DEST-01',
      });

      // pageSize 1 forces data.length === 1 regardless of whether the count
      // query was filtered — only asserting `total` distinguishes a filter
      // applied to both statements from one applied to only the page query.
      const result = await repo.list(1, 1, 'tornillo');

      expect(result.rows.length).toBe(1);
      expect(result.total).toBe(2);
    });

    it('treats an unescaped %, _ or \\ in q as a literal character, not a wildcard', async () => {
      await insertProducto(proveedorId, {
        nombre: 'Descuento 50% Especial',
        sku: 'PCT-001',
      });
      await insertProducto(proveedorId, {
        nombre: 'Under_score Widget',
        sku: 'US-001',
      });
      await insertProducto(proveedorId, {
        nombre: 'Back\\slash Item',
        sku: 'BS-001',
      });
      await insertProducto(proveedorId, {
        nombre: 'Plain Product',
        sku: 'PLAIN-001',
      });

      const percent = await repo.list(1, 10, '%');
      expect(percent.total).toBe(1);
      expect(percent.rows[0]?.sku).toBe('PCT-001');

      const underscore = await repo.list(1, 10, '_');
      expect(underscore.total).toBe(1);
      expect(underscore.rows[0]?.sku).toBe('US-001');

      const backslash = await repo.list(1, 10, '\\');
      expect(backslash.total).toBe(1);
      expect(backslash.rows[0]?.sku).toBe('BS-001');
    });
  });

  describe('findById', () => {
    it('returns undefined for a missing id', async () => {
      const result = await repo.findById(randomUUID());
      expect(result).toBeUndefined();
    });
  });

  describe('create — duplicate SKU mapping', () => {
    it('surfaces SKU_ALREADY_IN_USE, not a raw pg error, case-insensitively', async () => {
      await insertProducto(proveedorId, { sku: 'ABC-1' });

      await expect(
        repo.create({
          nombre: 'Otro producto',
          sku: 'abc-1',
          precio: '5.00',
          proveedorId,
        }),
      ).rejects.toMatchObject({ code: 'SKU_ALREADY_IN_USE' });
    });
  });

  describe('update — duplicate SKU mapping', () => {
    it('surfaces SKU_ALREADY_IN_USE, not a raw pg error, on a colliding sku', async () => {
      await insertProducto(proveedorId, { sku: 'ABC-1' });
      const target = await insertProducto(proveedorId, { sku: 'XYZ-9' });

      await expect(
        repo.update(target.id, { sku: 'abc-1' }),
      ).rejects.toMatchObject({ code: 'SKU_ALREADY_IN_USE' });
    });

    // Compile-level assertion (design.md's interface + tasks.md task 2.1):
    // CambiosProducto has no stockActual key at all — not optional, absent.
    // aplicarDelta is the only seam through which stock ever changes.
    it('never accepts a stockActual key at the type level', () => {
      const cambios: CambiosProducto = {
        // @ts-expect-error — stockActual must not exist on CambiosProducto
        stockActual: 99,
      };
      expect(cambios).toBeDefined();
    });
  });

  describe('setActivo — never deletes', () => {
    it('setActivo(id, false) leaves the row present and readable', async () => {
      const producto = await insertProducto(proveedorId);

      const result = await repo.setActivo(producto.id, false);

      expect(result.activo).toBe(false);
      const row = await repo.findById(producto.id);
      expect(row).toBeDefined();
      expect(row?.activo).toBe(false);
    });
  });

  describe('aplicarDelta (D1 — single conditional UPDATE)', () => {
    it('returns the new stock_actual on a normal increment', async () => {
      const producto = await insertProducto(proveedorId, { stockActual: 10 });

      const result = await repo.aplicarDelta(producto.id, 5);

      expect(result).toBe(15);
      const row = await repo.findById(producto.id);
      expect(row?.stockActual).toBe(15);
    });

    it('returns undefined when the product is inactive, and leaves stock unchanged', async () => {
      const producto = await insertProducto(proveedorId, {
        stockActual: 10,
        activo: false,
      });

      const result = await repo.aplicarDelta(producto.id, 5);

      expect(result).toBeUndefined();
      const row = await repo.findById(producto.id);
      expect(row?.stockActual).toBe(10);
    });

    it('returns undefined when the result would go negative, and leaves stock unchanged', async () => {
      const producto = await insertProducto(proveedorId, { stockActual: 5 });

      const result = await repo.aplicarDelta(producto.id, -10);

      expect(result).toBeUndefined();
      const row = await repo.findById(producto.id);
      expect(row?.stockActual).toBe(5);
    });

    // backlog #9 (anulacion-venta) tasks.md 5.1's A8-exemption scenario,
    // proven here at the repository level (design.md's Testing Strategy
    // row): unlike aplicarDelta, an inactive product's stock still reverts.
    it.each([true, false])(
      'reverts stock by the positive cantidad even when activo = %s',
      async (activo) => {
        const producto = await insertProducto(proveedorId, {
          stockActual: 10,
          activo,
        });

        const result = await repo.revertirStockPorAnulacion(producto.id, 3);

        expect(result).toBe(13);
        const row = await repo.findById(producto.id);
        expect(row?.stockActual).toBe(13);
        expect(row?.activo).toBe(activo);
      },
    );

    // The proof named by tasks.md task 2.1: the single UPDATE statement is
    // what makes concurrent calls serialize on the row itself, never a
    // SELECT ... FOR UPDATE followed by a plain SET. Twenty concurrent +1
    // increments starting from 0 must all land — a read-then-write race
    // would lose updates and the final total would be under 20.
    it('serializes concurrent calls on the row, losing no update', async () => {
      const producto = await insertProducto(proveedorId, { stockActual: 0 });
      const concurrentCalls = 20;

      const results = await Promise.all(
        Array.from({ length: concurrentCalls }, () =>
          repo.aplicarDelta(producto.id, 1),
        ),
      );

      expect(results.every((r) => r !== undefined)).toBe(true);
      const distinctValues = new Set(results);
      expect(distinctValues.size).toBe(concurrentCalls);
      expect([...distinctValues].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
        Array.from({ length: concurrentCalls }, (_, i) => i + 1),
      );

      const row = await repo.findById(producto.id);
      expect(row?.stockActual).toBe(concurrentCalls);
    });
  });
});
