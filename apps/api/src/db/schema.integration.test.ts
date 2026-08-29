import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from './pool.js';
import { movimientos, productos, proveedores, usuarios } from './schema.js';

// Real Docker Postgres suite. Proves the D1 functional unique index is only
// truly provable against a real database, never against a fake: Postgres
// itself must fold `lower(nombre)` and raise 23505 on the collision, and the
// stored value must survive untouched — no fake pool can assert either.
const db = getDb();

async function insertProveedor(overrides: {
  nombre: string;
  activo?: boolean;
}) {
  return db
    .insert(proveedores)
    .values({
      nombre: overrides.nombre,
      activo: overrides.activo ?? true,
    })
    .returning();
}

// Ends the shared pool once, after every describe block in this file has
// finished — not per describe block, which would close the pool out from
// under a later block sharing the same module-level `db`.
afterAll(async () => {
  await getPool().end();
});

describe('proveedores schema (integration, real Postgres)', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table proveedores cascade`);
  });

  describe('D1 — proveedores_nombre_lower_unique', () => {
    it('raises 23505 on a case-differing duplicate name', async () => {
      await insertProveedor({ nombre: 'Distribuidora Norte' });

      await expect(
        insertProveedor({ nombre: 'distribuidora norte' }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });
    });

    it('raises 23505 on an all-uppercase duplicate name', async () => {
      await insertProveedor({ nombre: 'Distribuidora Norte' });

      await expect(
        insertProveedor({ nombre: 'DISTRIBUIDORA NORTE' }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });
    });

    it('stores the original casing exactly — never lowercased or altered', async () => {
      await insertProveedor({ nombre: 'Distribuidora Norte' });

      const [row] = await db
        .select({ nombre: proveedores.nombre })
        .from(proveedores);

      expect(row?.nombre).toBe('Distribuidora Norte');
    });

    it('an inactive row still blocks a case-differing duplicate', async () => {
      await insertProveedor({ nombre: 'Distribuidora Norte', activo: false });

      await expect(
        insertProveedor({ nombre: 'DISTRIBUIDORA NORTE' }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });
    });

    // Measured on this container 2026-08-28: datcollate = datctype =
    // en_US.utf8, and lower('ÑANDÚ') = 'ñandú' is true — so this accented
    // pair collides. Asserted against the database's actual behaviour, not
    // assumed (design.md Open Question 1).
    it('folds the accented pair Ñandú / ñandú under this collation, so it also collides', async () => {
      await insertProveedor({ nombre: 'Ñandú' });

      await expect(insertProveedor({ nombre: 'ñandú' })).rejects.toMatchObject({
        cause: { code: '23505' },
      });
    });
  });
});

// productos/movimientos schema (backlog #5, S1a). Proves the CHECK
// constraints and the case-insensitive SKU unique index only truly provable
// against a real database, and the FK from productos.proveedor_id to
// proveedores.id (R3: NOT NULL, owner decision 2026-08-29).
describe('productos/movimientos schema (integration, real Postgres)', () => {
  beforeEach(async () => {
    await db.execute(
      sql`truncate table movimientos, productos, proveedores, usuarios cascade`,
    );
  });

  async function insertProveedorRow(nombre: string) {
    const [row] = await db
      .insert(proveedores)
      .values({ nombre, activo: true })
      .returning();
    if (!row) {
      throw new Error('failed to insert fixture proveedor');
    }
    return row;
  }

  async function insertUsuarioRow() {
    const [row] = await db
      .insert(usuarios)
      .values({
        nombre: 'Schema Test User',
        email: `schema-test-${randomUUID()}@example.com`,
        hashContrasena: 'irrelevant-for-this-test',
        rol: 'deposito',
      })
      .returning();
    if (!row) {
      throw new Error('failed to insert fixture usuario');
    }
    return row;
  }

  async function insertProducto(overrides: {
    nombre: string;
    sku: string;
    precio: string;
    proveedorId: string;
    stockActual?: number;
  }) {
    return db
      .insert(productos)
      .values({
        nombre: overrides.nombre,
        sku: overrides.sku,
        precio: overrides.precio,
        proveedorId: overrides.proveedorId,
        stockActual: overrides.stockActual ?? 0,
      })
      .returning();
  }

  describe('movimientos_signo_tipo CHECK', () => {
    it('rejects an entrada with a negative cantidad', async () => {
      const proveedor = await insertProveedorRow('Proveedor Uno');
      const [producto] = await insertProducto({
        nombre: 'Producto Uno',
        sku: 'SKU-001',
        precio: '10.00',
        proveedorId: proveedor.id,
      });
      if (!producto) throw new Error('failed to insert fixture producto');
      const usuario = await insertUsuarioRow();

      await expect(
        db.insert(movimientos).values({
          productoId: producto.id,
          usuarioId: usuario.id,
          tipo: 'entrada',
          cantidad: -5,
          stockResultante: 5,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects a salida with a positive cantidad', async () => {
      const proveedor = await insertProveedorRow('Proveedor Uno');
      const [producto] = await insertProducto({
        nombre: 'Producto Uno',
        sku: 'SKU-001',
        precio: '10.00',
        proveedorId: proveedor.id,
      });
      if (!producto) throw new Error('failed to insert fixture producto');
      const usuario = await insertUsuarioRow();

      await expect(
        db.insert(movimientos).values({
          productoId: producto.id,
          usuarioId: usuario.id,
          tipo: 'salida',
          cantidad: 5,
          stockResultante: 0,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects a venta with a positive cantidad', async () => {
      const proveedor = await insertProveedorRow('Proveedor Uno');
      const [producto] = await insertProducto({
        nombre: 'Producto Uno',
        sku: 'SKU-001',
        precio: '10.00',
        proveedorId: proveedor.id,
      });
      if (!producto) throw new Error('failed to insert fixture producto');
      const usuario = await insertUsuarioRow();

      await expect(
        db.insert(movimientos).values({
          productoId: producto.id,
          usuarioId: usuario.id,
          tipo: 'venta',
          cantidad: 5,
          stockResultante: 0,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('accepts an ajuste with either sign', async () => {
      const proveedor = await insertProveedorRow('Proveedor Uno');
      const [producto] = await insertProducto({
        nombre: 'Producto Uno',
        sku: 'SKU-001',
        precio: '10.00',
        proveedorId: proveedor.id,
      });
      if (!producto) throw new Error('failed to insert fixture producto');
      const usuario = await insertUsuarioRow();

      await expect(
        db.insert(movimientos).values({
          productoId: producto.id,
          usuarioId: usuario.id,
          tipo: 'ajuste',
          cantidad: -3,
          stockResultante: -3,
        }),
      ).resolves.not.toThrow();

      await expect(
        db.insert(movimientos).values({
          productoId: producto.id,
          usuarioId: usuario.id,
          tipo: 'ajuste',
          cantidad: 3,
          stockResultante: 0,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('movimientos_discrepancia_solo_ajuste CHECK', () => {
    it('rejects es_discrepancia = true with tipo = entrada', async () => {
      const proveedor = await insertProveedorRow('Proveedor Uno');
      const [producto] = await insertProducto({
        nombre: 'Producto Uno',
        sku: 'SKU-001',
        precio: '10.00',
        proveedorId: proveedor.id,
      });
      if (!producto) throw new Error('failed to insert fixture producto');
      const usuario = await insertUsuarioRow();

      await expect(
        db.insert(movimientos).values({
          productoId: producto.id,
          usuarioId: usuario.id,
          tipo: 'entrada',
          cantidad: 5,
          stockResultante: 5,
          esDiscrepancia: true,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('accepts es_discrepancia = true with tipo = ajuste', async () => {
      const proveedor = await insertProveedorRow('Proveedor Uno');
      const [producto] = await insertProducto({
        nombre: 'Producto Uno',
        sku: 'SKU-001',
        precio: '10.00',
        proveedorId: proveedor.id,
      });
      if (!producto) throw new Error('failed to insert fixture producto');
      const usuario = await insertUsuarioRow();

      await expect(
        db.insert(movimientos).values({
          productoId: producto.id,
          usuarioId: usuario.id,
          tipo: 'ajuste',
          cantidad: 5,
          stockResultante: 5,
          esDiscrepancia: true,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('productos_sku_lower_unique', () => {
    it('collides on SKUs differing only by case, keeping the surviving row original casing', async () => {
      const proveedor = await insertProveedorRow('Proveedor Uno');
      await insertProducto({
        nombre: 'Producto Uno',
        sku: 'ABC-1',
        precio: '10.00',
        proveedorId: proveedor.id,
      });

      await expect(
        insertProducto({
          nombre: 'Producto Dos',
          sku: 'abc-1',
          precio: '20.00',
          proveedorId: proveedor.id,
        }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });

      const [row] = await db.select({ sku: productos.sku }).from(productos);
      expect(row?.sku).toBe('ABC-1');
    });
  });

  describe('productos.proveedor_id FK', () => {
    it('rejects an insert referencing a nonexistent proveedor', async () => {
      await expect(
        insertProducto({
          nombre: 'Producto Uno',
          sku: 'SKU-001',
          precio: '10.00',
          proveedorId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });
  });

  // The `pnpm db:generate` round-trip proof (task 1.1's last assertion) is
  // verified procedurally as task 1.4, not as a vitest assertion: shelling
  // out to drizzle-kit from inside the suite would mutate migration files as
  // a side effect of every test run, which is a build-step concern, not a
  // database-behavior assertion.
});
