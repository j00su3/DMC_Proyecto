import { describe, expect, it, vi } from 'vitest';
import type { UnitOfWork } from '../db/uow.js';
import type { Repos } from '../plugins/repos.js';
import type { Proveedor } from '../proveedores/repository.js';
import type { Producto } from './repository.js';
import {
  actualizarProducto,
  crearProducto,
  getProducto,
  listProductos,
  requireActor,
  setProductoActivo,
} from './service.js';

const ACTOR_ENCARGADO_ID = '00000000-0000-4000-8000-0000000000e1';
const ACTOR_DEPOSITO_ID = '00000000-0000-4000-8000-0000000000d1';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PROVEEDOR_ID = '22222222-2222-4222-8222-222222222222';

function proveedor(over: Partial<Proveedor> = {}): Proveedor {
  return {
    id: PROVEEDOR_ID,
    nombre: 'Distribuidora Norte',
    contacto: null,
    activo: true,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

function producto(over: Partial<Producto> = {}): Producto {
  return {
    id: PRODUCT_ID,
    nombre: 'Tornillo Phillips',
    sku: 'TP-001',
    categoria: null,
    stockActual: 0,
    stockMinimo: null,
    precio: '10.00',
    proveedorId: PROVEEDOR_ID,
    activo: true,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

interface CallRecord {
  method: string;
  insideTransaction: boolean;
}

// Mirrors proveedores/service.test.ts's harness: a UnitOfWork whose run()
// really opens and closes (transactionOpen), so the suite can assert WHERE
// each repo call happened, not just that it happened. `run` is itself a
// vi.fn so a test can assert it was never invoked at all — the proof rule 1
// asks for, not just "the call threw".
function harness(
  options: {
    proveedor?: Proveedor | undefined;
    productoCreado?: Producto;
    aplicarDeltaResult?: number | undefined;
    // Row returned by findByIdForUpdate/findById for the update/deactivate/
    // get paths. Distinct key from `proveedor`'s presence-check idiom, since
    // `undefined` here is itself a meaningful test case (product not found)
    // rather than "use the default".
    productoActual?: Producto | undefined;
  } = {},
) {
  let transactionOpen = false;
  const calls: CallRecord[] = [];

  const spy = <T>(method: string, result: (...args: never[]) => T) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, insideTransaction: transactionOpen });
      return result(...(args as never[]));
    });

  const proveedorRow = 'proveedor' in options ? options.proveedor : proveedor();
  const productoRow = options.productoCreado ?? producto();
  const productoActualRow =
    'productoActual' in options ? options.productoActual : producto();

  const proveedores = {
    findById: spy('proveedores.findById', async () => proveedorRow),
  };

  const productos = {
    create: spy('productos.create', async () => productoRow),
    aplicarDelta: spy(
      'productos.aplicarDelta',
      async () => options.aplicarDeltaResult,
    ),
    findByIdForUpdate: spy(
      'productos.findByIdForUpdate',
      async () => productoActualRow,
    ),
    findById: spy('productos.findById', async () => productoActualRow),
    update: spy('productos.update', async (_id: unknown, cambios: unknown) => ({
      ...producto(),
      ...(cambios as object),
    })),
    setActivo: spy(
      'productos.setActivo',
      async (_id: unknown, activo: unknown) =>
        producto({ activo: activo as boolean }),
    ),
    list: spy('productos.list', async () => ({ rows: [], total: 0 })),
  };

  const movimientos = {
    create: spy('movimientos.create', async (input: unknown) => ({
      id: 'mov-1',
      ...(input as object),
    })),
  };

  const auditoria = { record: spy('auditoria.record', async () => {}) };

  const repos = {
    proveedores,
    productos,
    movimientos,
    auditoria,
  } as unknown as Repos;

  const run = vi.fn(async (work: (repos: Repos) => Promise<unknown>) => {
    transactionOpen = true;
    try {
      return await work(repos);
    } finally {
      transactionOpen = false;
    }
  });

  const uow = { run } as unknown as UnitOfWork;

  return { repos, uow, proveedores, productos, movimientos, auditoria, calls };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    nombre: 'Tornillo Phillips',
    sku: 'TP-001',
    precio: '10.00',
    proveedorId: PROVEEDOR_ID,
    stockInicial: 0,
    actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' as const },
    ...overrides,
  };
}

describe('crearProducto', () => {
  it('with stockInicial = 0 calls productos.create and not movimientos.create or aplicarDelta', async () => {
    const h = harness();

    await crearProducto(
      h.repos,
      h.uow,
      // biome-ignore lint/suspicious/noExplicitAny: test harness fixture
      baseInput() as any,
    );

    expect(h.productos.create).toHaveBeenCalledTimes(1);
    expect(h.productos.aplicarDelta).not.toHaveBeenCalled();
    expect(h.movimientos.create).not.toHaveBeenCalled();
  });

  it('with stockInicial > 0 calls create, then aplicarDelta, then movimientos.create with stockResultante taken verbatim from aplicarDelta, never recomputed', async () => {
    // aplicarDelta returns a value deliberately NOT equal to stockInicial —
    // if the service (or this test) recomputed stockResultante instead of
    // using aplicarDelta's own return value, this assertion would catch it.
    const h = harness({ aplicarDeltaResult: 999 });

    // biome-ignore lint/suspicious/noExplicitAny: test harness fixture
    await crearProducto(h.repos, h.uow, baseInput({ stockInicial: 50 }) as any);

    expect(h.productos.create).toHaveBeenCalledWith(
      expect.objectContaining({ proveedorId: PROVEEDOR_ID }),
    );
    expect(h.productos.aplicarDelta).toHaveBeenCalledWith(PRODUCT_ID, 50);
    expect(h.movimientos.create).toHaveBeenCalledWith({
      productoId: PRODUCT_ID,
      tipo: 'ajuste',
      cantidad: 50,
      motivo: 'stock inicial (alta de producto)',
      esDiscrepancia: false,
      usuarioId: ACTOR_ENCARGADO_ID,
      stockResultante: 999,
    });

    const order = h.calls.map((c) => c.method);
    expect(order.indexOf('productos.create')).toBeLessThan(
      order.indexOf('productos.aplicarDelta'),
    );
    expect(order.indexOf('productos.aplicarDelta')).toBeLessThan(
      order.indexOf('movimientos.create'),
    );
  });

  it('a deposito actor whose payload includes the key stockMinimo (including null) throws fieldReservedForEncargado before uow.run is ever called', async () => {
    const h = harness();

    await expect(
      crearProducto(
        h.repos,
        h.uow,
        baseInput({
          stockMinimo: null,
          actor: { id: ACTOR_DEPOSITO_ID, rol: 'deposito' },
          // biome-ignore lint/suspicious/noExplicitAny: test harness fixture
        }) as any,
      ),
    ).rejects.toMatchObject({ code: 'FIELD_RESERVED_FOR_ENCARGADO' });

    // The proof, not just "it throws": uow.run itself was never invoked, so
    // no transaction was ever opened for this request.
    expect(h.uow.run).not.toHaveBeenCalled();
  });

  it('the identical payload without the stockMinimo key succeeds for deposito', async () => {
    const h = harness();

    await expect(
      crearProducto(
        h.repos,
        h.uow,
        baseInput({
          actor: { id: ACTOR_DEPOSITO_ID, rol: 'deposito' },
          // biome-ignore lint/suspicious/noExplicitAny: test harness fixture
        }) as any,
      ),
    ).resolves.toBeDefined();
    expect(h.uow.run).toHaveBeenCalledTimes(1);
  });

  it('an encargado actor sets stockMinimo freely', async () => {
    const h = harness();

    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: test harness fixture
      crearProducto(h.repos, h.uow, baseInput({ stockMinimo: 10 }) as any),
    ).resolves.toBeDefined();
    expect(h.productos.create).toHaveBeenCalledWith(
      expect.objectContaining({ stockMinimo: 10 }),
    );
  });

  it('proveedores.findById returning undefined throws supplierNotFound before uow.run', async () => {
    const h = harness({ proveedor: undefined });

    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: test harness fixture
      crearProducto(h.repos, h.uow, baseInput() as any),
    ).rejects.toMatchObject({ code: 'SUPPLIER_NOT_FOUND' });
    expect(h.uow.run).not.toHaveBeenCalled();
  });

  it('an inactive supplier throws supplierInactive before uow.run', async () => {
    const h = harness({ proveedor: proveedor({ activo: false }) });

    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: test harness fixture
      crearProducto(h.repos, h.uow, baseInput() as any),
    ).rejects.toMatchObject({ code: 'SUPPLIER_INACTIVE' });
    expect(h.uow.run).not.toHaveBeenCalled();
  });

  it('runs every write inside exactly one uow.run invocation', async () => {
    const h = harness({ aplicarDeltaResult: 5 });

    await crearProducto(
      h.repos,
      h.uow,
      // biome-ignore lint/suspicious/noExplicitAny: test harness fixture
      baseInput({ stockInicial: 5 }) as any,
    );

    // proveedores.findById is the one read the guard runs BEFORE uow.run
    // opens (rule 3) — every WRITE (create/aplicarDelta/movimientos.create/
    // auditoria.record) must be inside it, exactly once.
    expect(h.uow.run).toHaveBeenCalledTimes(1);
    const writeCalls = h.calls.filter(
      (c) => c.method !== 'proveedores.findById',
    );
    expect(writeCalls.length).toBeGreaterThan(0);
    expect(writeCalls.every((c) => c.insideTransaction)).toBe(true);
  });

  it('recordAudit is the last statement inside uow.run', async () => {
    const h = harness();

    // biome-ignore lint/suspicious/noExplicitAny: test harness fixture
    await crearProducto(h.repos, h.uow, baseInput() as any);

    expect(h.calls.at(-1)?.method).toBe('auditoria.record');
  });
});

describe('actualizarProducto', () => {
  it('with an empty diff makes no repo write and no recordAudit call (mirrors proveedores/service.ts D10)', async () => {
    const h = harness();
    const actual = producto();

    const result = await actualizarProducto(h.repos, h.uow, {
      id: PRODUCT_ID,
      cambios: { nombre: actual.nombre },
      actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
    });

    expect(h.productos.update).not.toHaveBeenCalled();
    expect(h.auditoria.record).not.toHaveBeenCalled();
    expect(result).toEqual(actual);
  });

  it('findByIdForUpdate returning undefined throws productNotFound before any write', async () => {
    const h = harness({ productoActual: undefined });

    await expect(
      actualizarProducto(h.repos, h.uow, {
        id: PRODUCT_ID,
        cambios: { nombre: 'Nuevo Nombre' },
        actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });

    expect(h.productos.update).not.toHaveBeenCalled();
    expect(h.auditoria.record).not.toHaveBeenCalled();
  });

  it('a deposito actor whose payload includes the key stockMinimo throws fieldReservedForEncargado before uow.run', async () => {
    const h = harness();

    await expect(
      actualizarProducto(h.repos, h.uow, {
        id: PRODUCT_ID,
        cambios: { stockMinimo: null },
        actor: { id: ACTOR_DEPOSITO_ID, rol: 'deposito' },
      }),
    ).rejects.toMatchObject({ code: 'FIELD_RESERVED_FOR_ENCARGADO' });
    expect(h.uow.run).not.toHaveBeenCalled();
  });

  it('a PATCH that includes proveedorId re-runs the inactive-supplier guard', async () => {
    const h = harness({ proveedor: proveedor({ activo: false }) });

    await expect(
      actualizarProducto(h.repos, h.uow, {
        id: PRODUCT_ID,
        cambios: { proveedorId: PROVEEDOR_ID },
        actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
      }),
    ).rejects.toMatchObject({ code: 'SUPPLIER_INACTIVE' });
    expect(h.uow.run).not.toHaveBeenCalled();
  });

  // D8's TOCTOU-avoidance clause, and the assertion the proposal calls "the
  // one that matters more": the guard is keyed on the INCOMING payload, not
  // the product's stored supplier. A PATCH that omits proveedorId must
  // never re-run it, even when the row's existing supplier is already
  // inactive — otherwise a product whose supplier was later deactivated
  // becomes permanently uneditable, unable even to have its name fixed.
  it('a PATCH that omits proveedorId does NOT re-run the inactive-supplier guard, even when the product row already references an inactive supplier', async () => {
    const h = harness({ proveedor: proveedor({ activo: false }) });

    await expect(
      actualizarProducto(h.repos, h.uow, {
        id: PRODUCT_ID,
        cambios: { nombre: 'Nombre Corregido' },
        actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
      }),
    ).resolves.toBeDefined();

    expect(h.proveedores.findById).not.toHaveBeenCalled();
    expect(h.productos.update).toHaveBeenCalledTimes(1);
  });

  it('runs the update and recordAudit inside uow.run', async () => {
    const h = harness();

    await actualizarProducto(h.repos, h.uow, {
      id: PRODUCT_ID,
      cambios: { nombre: 'Nombre Corregido' },
      actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
    });

    expect(h.uow.run).toHaveBeenCalledTimes(1);
    const writeCalls = h.calls.filter(
      (c) => c.method === 'productos.update' || c.method === 'auditoria.record',
    );
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls.every((c) => c.insideTransaction)).toBe(true);
  });
});

describe('setProductoActivo', () => {
  it('setProductoActivo(id, false) wraps one repo call and one recordAudit inside a single uow.run', async () => {
    const h = harness();

    await setProductoActivo(h.uow, {
      id: PRODUCT_ID,
      activo: false,
      actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
    });

    expect(h.productos.setActivo).toHaveBeenCalledWith(PRODUCT_ID, false);
    expect(h.productos.setActivo).toHaveBeenCalledTimes(1);
    expect(h.auditoria.record).toHaveBeenCalledTimes(1);
    expect(h.uow.run).toHaveBeenCalledTimes(1);
    const writeCalls = h.calls.filter(
      (c) =>
        c.method === 'productos.setActivo' || c.method === 'auditoria.record',
    );
    expect(writeCalls.every((c) => c.insideTransaction)).toBe(true);
  });

  it('setProductoActivo(id, true) wraps one repo call and one recordAudit inside a single uow.run', async () => {
    const h = harness();

    await setProductoActivo(h.uow, {
      id: PRODUCT_ID,
      activo: true,
      actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
    });

    expect(h.productos.setActivo).toHaveBeenCalledWith(PRODUCT_ID, true);
    expect(h.productos.setActivo).toHaveBeenCalledTimes(1);
    expect(h.auditoria.record).toHaveBeenCalledTimes(1);
    expect(h.uow.run).toHaveBeenCalledTimes(1);
  });
});

describe('listProductos', () => {
  it('passes q through to the repository unchanged', async () => {
    const h = harness();

    await listProductos(h.repos, { page: 2, pageSize: 10, q: 'torn' });

    expect(h.productos.list).toHaveBeenCalledWith(2, 10, 'torn');
  });

  it('passes an undefined q through unchanged', async () => {
    const h = harness();

    await listProductos(h.repos, { page: 1, pageSize: 20 });

    expect(h.productos.list).toHaveBeenCalledWith(1, 20, undefined);
  });
});

describe('getProducto', () => {
  it('returns the product for a found id', async () => {
    const h = harness();

    const result = await getProducto(h.repos, PRODUCT_ID);

    expect(result).toEqual(producto());
    expect(h.productos.findById).toHaveBeenCalledWith(PRODUCT_ID);
  });

  it('throws productNotFound for an id that matches no row', async () => {
    const h = harness({ productoActual: undefined });

    await expect(getProducto(h.repos, PRODUCT_ID)).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
    });
  });
});

describe('requireActor', () => {
  it('returns the id and rol from a resolved user', () => {
    expect(requireActor({ id: ACTOR_ENCARGADO_ID, rol: 'encargado' })).toEqual({
      id: ACTOR_ENCARGADO_ID,
      rol: 'encargado',
    });
  });

  it('throws unauthorized for a null user', () => {
    expect(() => requireActor(null)).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
  });
});
