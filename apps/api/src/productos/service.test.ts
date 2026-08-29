import { describe, expect, it, vi } from 'vitest';
import type { UnitOfWork } from '../db/uow.js';
import type { Repos } from '../plugins/repos.js';
import type { Proveedor } from '../proveedores/repository.js';
import type { Producto } from './repository.js';
import { crearProducto, requireActor } from './service.js';

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

  const proveedores = {
    findById: spy('proveedores.findById', async () => proveedorRow),
  };

  const productos = {
    create: spy('productos.create', async () => productoRow),
    aplicarDelta: spy(
      'productos.aplicarDelta',
      async () => options.aplicarDeltaResult,
    ),
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
