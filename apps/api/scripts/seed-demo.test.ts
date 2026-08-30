import { describe, expect, it, vi } from 'vitest';
import {
  DEMO_PRODUCTOS,
  DEMO_PROVEEDORES,
  type SeedDemoDeps,
  seedDemo,
} from './seed-demo.js';

// Mirrors `apps/web/src/features/productos/format.ts`'s `estadoStock` (D9).
// Duplicated rather than imported because that module lives in the web
// package; if D9's branching ever changes, this must change with it.
function estadoStock(
  stockActual: number,
  stockMinimo: number | null,
): 'quiebre' | 'bajo' | 'ok' {
  if (stockActual <= 0) return 'quiebre';
  if (stockMinimo !== null && stockActual <= stockMinimo) return 'bajo';
  return 'ok';
}

function createDeps(overrides: Partial<SeedDemoDeps> = {}): {
  deps: SeedDemoDeps;
  crearProducto: ReturnType<typeof vi.fn>;
} {
  const crearProducto = vi.fn(async () => ({ id: 'producto-id' }));
  const deps: SeedDemoDeps = {
    findEncargadoId: async () => 'encargado-id',
    findProveedorIdByNombre: async () => undefined,
    findProductoIdBySku: async () => undefined,
    crearProveedor: vi.fn(async () => ({ id: 'proveedor-id' })),
    crearProducto,
    ...overrides,
  };
  return { deps, crearProducto };
}

describe('demo dataset', () => {
  // The reason this script exists. A dataset where every product is `ok`
  // renders three quarters of the list screen's status logic invisible, and
  // the walkthrough silently demonstrates less than it should.
  it('exercises every derived chip state, including no-threshold', () => {
    const estados = DEMO_PRODUCTOS.map((p) =>
      p.stockMinimo === null
        ? 'sin-chip'
        : estadoStock(p.stockInicial, p.stockMinimo),
    );

    expect(estados.filter((e) => e === 'quiebre').length).toBeGreaterThan(0);
    expect(estados.filter((e) => e === 'bajo').length).toBeGreaterThan(0);
    expect(estados.filter((e) => e === 'ok').length).toBeGreaterThan(0);
    expect(estados.filter((e) => e === 'sin-chip').length).toBeGreaterThan(0);
  });

  it('carries at least a dozen products', () => {
    expect(DEMO_PRODUCTOS.length).toBeGreaterThanOrEqual(12);
  });

  it('has no duplicate SKUs', () => {
    const skus = DEMO_PRODUCTOS.map((p) => p.sku.toLowerCase());
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('references only suppliers the dataset itself defines', () => {
    const nombres = new Set(DEMO_PROVEEDORES.map((p) => p.nombre));
    for (const producto of DEMO_PRODUCTOS) {
      expect(nombres.has(producto.proveedor)).toBe(true);
    }
  });
});

describe('seedDemo', () => {
  it('creates every supplier and product on an empty database', async () => {
    const { deps, crearProducto } = createDeps();

    const result = await seedDemo(deps);

    expect(result.proveedoresCreados).toHaveLength(DEMO_PROVEEDORES.length);
    expect(result.productosCreados).toHaveLength(DEMO_PRODUCTOS.length);
    expect(result.productosOmitidos).toHaveLength(0);
    expect(crearProducto).toHaveBeenCalledTimes(DEMO_PRODUCTOS.length);
  });

  // Re-running before a demo must be safe. Skipping is by SKU, so a product
  // someone edited by hand afterwards is left exactly as they left it.
  it('skips a product whose SKU already exists and never rewrites it', async () => {
    const takenSku = DEMO_PRODUCTOS[0]?.sku;
    const { deps, crearProducto } = createDeps({
      findProductoIdBySku: async (sku) =>
        sku === takenSku ? 'existing-id' : undefined,
    });

    const result = await seedDemo(deps);

    expect(result.productosOmitidos).toEqual([takenSku]);
    expect(result.productosCreados).toHaveLength(DEMO_PRODUCTOS.length - 1);
    expect(crearProducto).toHaveBeenCalledTimes(DEMO_PRODUCTOS.length - 1);
    for (const call of crearProducto.mock.calls) {
      expect(call[0].sku).not.toBe(takenSku);
    }
  });

  it('reuses an existing supplier instead of creating a second one', async () => {
    const taken = DEMO_PROVEEDORES[0]?.nombre;
    const { deps, crearProducto } = createDeps({
      findProveedorIdByNombre: async (nombre) =>
        nombre === taken ? 'existing-proveedor-id' : undefined,
    });

    const result = await seedDemo(deps);

    expect(result.proveedoresOmitidos).toEqual([taken]);
    const reused = crearProducto.mock.calls.filter(
      (call) => call[0].proveedor === taken,
    );
    expect(reused.length).toBeGreaterThan(0);
    for (const call of reused) {
      expect(call[0].proveedorId).toBe('existing-proveedor-id');
    }
  });

  // Every write is attributed to a real actor in the audit trail, so there
  // is no anonymous fallback to seed under.
  it('refuses to write anything when no encargado exists', async () => {
    const { deps, crearProducto } = createDeps({
      findEncargadoId: async () => undefined,
    });

    await expect(seedDemo(deps)).rejects.toThrow(/seed:encargado/);
    expect(crearProducto).not.toHaveBeenCalled();
  });
});
