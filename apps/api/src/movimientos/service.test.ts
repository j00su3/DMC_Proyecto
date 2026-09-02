import { describe, expect, it, vi } from 'vitest';
import type { TxControl, UnitOfWork } from '../db/uow.js';
import type { Repos } from '../plugins/repos.js';
import type { Producto } from '../productos/repository.js';
import {
  MOTIVO_MIN_LENGTH,
  type RegistrarMovimientoInput,
  registrarMovimiento,
} from './service.js';

const ACTOR_ENCARGADO_ID = '00000000-0000-4000-8000-0000000000e1';
const ACTOR_DEPOSITO_ID = '00000000-0000-4000-8000-0000000000d1';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function producto(over: Partial<Producto> = {}): Producto {
  return {
    id: PRODUCT_ID,
    nombre: 'Tornillo Phillips',
    sku: 'TP-001',
    categoria: null,
    stockActual: 10,
    stockMinimo: null,
    precio: '10.00',
    proveedorId: '22222222-2222-4222-8222-222222222222',
    activo: true,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

interface CallRecord {
  method: string;
  insideTransaction: boolean;
}

// Mirrors productos/service.test.ts's harness: a UnitOfWork whose run()
// really opens/closes (transactionOpen), so the suite can assert WHERE each
// repo call happened, and `run` itself is a vi.fn so a test can assert the
// transaction count directly (task 3.5).
function harness(
  options: {
    aplicarDeltaResult?: number | undefined;
    // Row returned by productos.findById — used BOTH for D1's classification
    // read (on the rejection path) and for D2's response read (on the
    // success path). `undefined` here is a meaningful case (product gone).
    productoActual?: Producto | undefined;
    alertCreateResult?: unknown;
    alertAutoResolveResult?: unknown;
  } = {},
) {
  let transactionOpen = false;
  const calls: CallRecord[] = [];

  const spy = <T>(method: string, result: (...args: never[]) => T) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, insideTransaction: transactionOpen });
      return result(...(args as never[]));
    });

  const productoRow =
    'productoActual' in options ? options.productoActual : producto();

  const productos = {
    aplicarDelta: spy(
      'productos.aplicarDelta',
      async () => options.aplicarDeltaResult,
    ),
    findById: spy('productos.findById', async () => productoRow),
  };

  const movimientos = {
    create: spy('movimientos.create', async (input: unknown) => ({
      id: 'mov-1',
      ...(input as object),
    })),
  };

  const auditoria = { record: spy('auditoria.record', async () => {}) };

  // Phase 2 (backlog #10): a fake alertas repo, defaulting to "no open
  // alert exists" (undefined) — the evaluator's dedup no-op path — so
  // pre-existing tests unrelated to alerts stay green without asserting
  // anything about alert rows.
  const alertas = {
    create: spy('alertas.create', async () => options.alertCreateResult),
    autoResolve: spy(
      'alertas.autoResolve',
      async () => options.alertAutoResolveResult,
    ),
  };

  const repos = {
    productos,
    movimientos,
    auditoria,
    alertas,
  } as unknown as Repos;

  // Fake TxControl: runs `work` and, on failure, swallows it and returns
  // undefined — mirrors the real savepoint()'s never-rethrow contract
  // (design.md D1/D2) without opening a real Postgres SAVEPOINT.
  const savepoint = vi.fn(
    async <T>(
      _name: string,
      work: () => Promise<T>,
    ): Promise<T | undefined> => {
      try {
        return await work();
      } catch {
        return undefined;
      }
    },
  );
  const tx = { savepoint } as unknown as TxControl;

  const run = vi.fn(
    async (work: (repos: Repos, tx: TxControl) => Promise<unknown>) => {
      transactionOpen = true;
      try {
        return await work(repos, tx);
      } finally {
        transactionOpen = false;
      }
    },
  );

  const uow = { run } as unknown as UnitOfWork;

  return { repos, uow, productos, movimientos, auditoria, alertas, tx, calls };
}

function baseInput(
  overrides: Partial<RegistrarMovimientoInput> = {},
): RegistrarMovimientoInput {
  return {
    productoId: PRODUCT_ID,
    operacion: 'entrada',
    cantidad: 5,
    esMerma: false,
    esDiscrepancia: false,
    actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
    ...overrides,
  };
}

describe('registrarMovimiento — D1 classification precedence', () => {
  it('aplicarDelta undefined + findById undefined -> productNotFound (404), never calls movimientos.create', async () => {
    const h = harness({
      aplicarDeltaResult: undefined,
      productoActual: undefined,
    });

    await expect(registrarMovimiento(h.uow, baseInput())).rejects.toMatchObject(
      {
        code: 'PRODUCT_NOT_FOUND',
        status: 404,
      },
    );

    expect(h.movimientos.create).not.toHaveBeenCalled();
  });

  it('aplicarDelta undefined + findById returns activo:false -> productInactive (409)', async () => {
    const h = harness({
      aplicarDeltaResult: undefined,
      productoActual: producto({ activo: false }),
    });

    await expect(registrarMovimiento(h.uow, baseInput())).rejects.toMatchObject(
      {
        code: 'PRODUCT_INACTIVE',
        status: 409,
      },
    );

    expect(h.movimientos.create).not.toHaveBeenCalled();
  });

  it('aplicarDelta undefined + findById returns an active row -> insufficientStock carrying the READ stock, not a recomputed value', async () => {
    const h = harness({
      aplicarDeltaResult: undefined,
      productoActual: producto({ activo: true, stockActual: 7 }),
    });

    await expect(
      registrarMovimiento(
        h.uow,
        baseInput({ operacion: 'salida', cantidad: 20 }),
      ),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      status: 409,
      details: { available: 7 },
    });

    expect(h.movimientos.create).not.toHaveBeenCalled();
  });
});

describe('registrarMovimiento — D8 motivo guard', () => {
  it('fires for ajuste with a blank motivo', async () => {
    const h = harness();

    await expect(
      registrarMovimiento(
        h.uow,
        baseInput({ operacion: 'ajuste', direccion: 'sumar', motivo: '   ' }),
      ),
    ).rejects.toMatchObject({ code: 'MOVEMENT_REASON_REQUIRED', status: 400 });
    expect(h.uow.run).not.toHaveBeenCalled();
  });

  it('fires for ajuste with an undefined motivo', async () => {
    const h = harness();

    await expect(
      registrarMovimiento(
        h.uow,
        baseInput({ operacion: 'ajuste', direccion: 'sumar' }),
      ),
    ).rejects.toMatchObject({ code: 'MOVEMENT_REASON_REQUIRED', status: 400 });
    expect(h.uow.run).not.toHaveBeenCalled();
  });

  it('fires for a merma salida with a blank/undefined motivo', async () => {
    const h = harness();

    await expect(
      registrarMovimiento(
        h.uow,
        baseInput({ operacion: 'salida', esMerma: true }),
      ),
    ).rejects.toMatchObject({ code: 'MOVEMENT_REASON_REQUIRED', status: 400 });
    expect(h.uow.run).not.toHaveBeenCalled();
  });

  it('does NOT fire for an ordinary entrada with no motivo', async () => {
    const h = harness({ aplicarDeltaResult: 15 });

    await expect(
      registrarMovimiento(h.uow, baseInput({ operacion: 'entrada' })),
    ).resolves.toBeDefined();
  });

  it('does NOT fire for a non-merma salida with no motivo', async () => {
    const h = harness({ aplicarDeltaResult: 5 });

    await expect(
      registrarMovimiento(
        h.uow,
        baseInput({ operacion: 'salida', esMerma: false, cantidad: 5 }),
      ),
    ).resolves.toBeDefined();
  });

  it(`accepts a ${MOTIVO_MIN_LENGTH}-character trimmed motivo ("abc")`, async () => {
    const h = harness({ aplicarDeltaResult: 5 });

    await expect(
      registrarMovimiento(
        h.uow,
        baseInput({ operacion: 'ajuste', direccion: 'sumar', motivo: 'abc' }),
      ),
    ).resolves.toBeDefined();
  });

  it('accepts "robo" (4 characters) as a merma motivo', async () => {
    const h = harness({ aplicarDeltaResult: 5 });

    await expect(
      registrarMovimiento(
        h.uow,
        baseInput({ operacion: 'salida', esMerma: true, motivo: 'robo' }),
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a 2-character motivo', async () => {
    const h = harness();

    await expect(
      registrarMovimiento(
        h.uow,
        baseInput({ operacion: 'ajuste', direccion: 'sumar', motivo: 'ok' }),
      ),
    ).rejects.toMatchObject({ code: 'MOVEMENT_REASON_REQUIRED', status: 400 });
    expect(h.uow.run).not.toHaveBeenCalled();
  });
});

describe('registrarMovimiento — D7 sign derivation', () => {
  it('entrada produces delta = +cantidad', async () => {
    const h = harness({ aplicarDeltaResult: 999 });

    await registrarMovimiento(
      h.uow,
      baseInput({ operacion: 'entrada', cantidad: 5 }),
    );

    expect(h.productos.aplicarDelta).toHaveBeenCalledWith(PRODUCT_ID, 5);
  });

  it('salida (ordinary) produces delta = -cantidad', async () => {
    const h = harness({ aplicarDeltaResult: 999 });

    await registrarMovimiento(
      h.uow,
      baseInput({ operacion: 'salida', cantidad: 5 }),
    );

    expect(h.productos.aplicarDelta).toHaveBeenCalledWith(PRODUCT_ID, -5);
  });

  it('salida por merma produces delta = -cantidad', async () => {
    const h = harness({ aplicarDeltaResult: 999 });

    await registrarMovimiento(
      h.uow,
      baseInput({
        operacion: 'salida',
        cantidad: 5,
        esMerma: true,
        motivo: 'robo',
      }),
    );

    expect(h.productos.aplicarDelta).toHaveBeenCalledWith(PRODUCT_ID, -5);
  });

  it("ajuste with direccion 'sumar' produces delta = +cantidad", async () => {
    const h = harness({ aplicarDeltaResult: 999 });

    await registrarMovimiento(
      h.uow,
      baseInput({
        operacion: 'ajuste',
        cantidad: 5,
        direccion: 'sumar',
        motivo: 'conteo',
      }),
    );

    expect(h.productos.aplicarDelta).toHaveBeenCalledWith(PRODUCT_ID, 5);
  });

  it("ajuste with direccion 'restar' produces delta = -cantidad", async () => {
    const h = harness({ aplicarDeltaResult: 999 });

    await registrarMovimiento(
      h.uow,
      baseInput({
        operacion: 'ajuste',
        cantidad: 5,
        direccion: 'restar',
        motivo: 'conteo',
      }),
    );

    expect(h.productos.aplicarDelta).toHaveBeenCalledWith(PRODUCT_ID, -5);
  });

  it("stockResultante on the created movement equals aplicarDelta's stub return value verbatim, never independently recomputed", async () => {
    // 999 is deliberately NOT reachable by any arithmetic on cantidad=5 — if
    // the service (or this test) recomputed stockResultante, this would fail.
    const h = harness({ aplicarDeltaResult: 999 });

    await registrarMovimiento(
      h.uow,
      baseInput({ operacion: 'entrada', cantidad: 5 }),
    );

    expect(h.movimientos.create).toHaveBeenCalledWith(
      expect.objectContaining({ stockResultante: 999 }),
    );
  });
});

describe('registrarMovimiento — no audit row is ever written', () => {
  it('auditoria.record is called zero times across entrada/salida/ajuste success paths', async () => {
    const h = harness({ aplicarDeltaResult: 5 });

    await registrarMovimiento(
      h.uow,
      baseInput({ operacion: 'entrada', cantidad: 5 }),
    );
    await registrarMovimiento(
      h.uow,
      baseInput({
        operacion: 'salida',
        cantidad: 5,
        esMerma: true,
        motivo: 'robo',
      }),
    );
    await registrarMovimiento(
      h.uow,
      baseInput({
        operacion: 'ajuste',
        cantidad: 5,
        direccion: 'sumar',
        esDiscrepancia: true,
        motivo: 'conteo físico',
      }),
    );

    expect(h.auditoria.record).not.toHaveBeenCalled();
  });
});

describe('registrarMovimiento — D2 transaction shape', () => {
  it('invokes uow.run exactly once per call', async () => {
    const h = harness({ aplicarDeltaResult: 5 });

    await registrarMovimiento(
      h.uow,
      baseInput({ operacion: 'entrada', cantidad: 5 }),
    );

    expect(h.uow.run).toHaveBeenCalledTimes(1);
  });

  it('entrada: movimientos.create is called with esMerma:false, esDiscrepancia:false', async () => {
    const h = harness({ aplicarDeltaResult: 5 });

    await registrarMovimiento(
      h.uow,
      baseInput({ operacion: 'entrada', cantidad: 5 }),
    );

    expect(h.movimientos.create).toHaveBeenCalledWith(
      expect.objectContaining({ esMerma: false, esDiscrepancia: false }),
    );
  });

  it('salida: movimientos.create is called with esMerma from input, esDiscrepancia:false', async () => {
    const h = harness({ aplicarDeltaResult: 5 });

    await registrarMovimiento(
      h.uow,
      baseInput({
        operacion: 'salida',
        cantidad: 5,
        esMerma: true,
        motivo: 'robo',
      }),
    );

    expect(h.movimientos.create).toHaveBeenCalledWith(
      expect.objectContaining({ esMerma: true, esDiscrepancia: false }),
    );
  });

  it('ajuste: movimientos.create is called with esMerma:false, esDiscrepancia from input', async () => {
    const h = harness({ aplicarDeltaResult: 5 });

    await registrarMovimiento(
      h.uow,
      baseInput({
        operacion: 'ajuste',
        cantidad: 5,
        direccion: 'sumar',
        esDiscrepancia: true,
        motivo: 'conteo físico',
      }),
    );

    expect(h.movimientos.create).toHaveBeenCalledWith(
      expect.objectContaining({ esMerma: false, esDiscrepancia: true }),
    );
  });

  it('every write (aplicarDelta, movimientos.create, productos.findById-for-response) happens inside uow.run', async () => {
    const h = harness({ aplicarDeltaResult: 5 });

    await registrarMovimiento(
      h.uow,
      baseInput({ operacion: 'entrada', cantidad: 5 }),
    );

    expect(h.calls.length).toBeGreaterThan(0);
    expect(h.calls.every((c) => c.insideTransaction)).toBe(true);
  });
});

// Phase 2 (backlog #10), task 2.4: the evaluator runs at the SEAM after the
// post-movement producto re-read, wrapped in tx.savepoint('alertas', ...).
describe('registrarMovimiento — alert evaluator wiring (SEAM)', () => {
  it('invokes tx.savepoint and calls alertas.create with the RE-READ product stockMinimo', async () => {
    // salida cantidad=5 -> delta=-5, aplicarDelta drops stock to 3, so
    // stockPrevio = 3 - (-5) = 8. The re-read producto carries
    // stockMinimo=5, so the crossing (previo=8 -> resultante=3) fires
    // stock_bajo. stockActual on the re-read row is deliberately different
    // (12) from stockResultante (3) — proves the evaluator uses stockMinimo
    // from the re-read, not a recomputed/derived value.
    const h = harness({
      aplicarDeltaResult: 3,
      productoActual: producto({ stockMinimo: 5, stockActual: 12 }),
    });

    await registrarMovimiento(
      h.uow,
      baseInput({ operacion: 'salida', cantidad: 5 }),
    );

    expect(h.tx.savepoint).toHaveBeenCalledWith(
      'alertas',
      expect.any(Function),
    );
    expect(h.alertas.create).toHaveBeenCalledWith(
      expect.objectContaining({ productoId: PRODUCT_ID, tipo: 'stock_bajo' }),
    );
  });

  it('does not create an alert when the movement does not cross any threshold', async () => {
    const h = harness({
      aplicarDeltaResult: 20,
      productoActual: producto({ stockMinimo: 5, stockActual: 20 }),
    });

    await registrarMovimiento(
      h.uow,
      baseInput({ operacion: 'entrada', cantidad: 5 }),
    );

    expect(h.tx.savepoint).toHaveBeenCalledWith(
      'alertas',
      expect.any(Function),
    );
    expect(h.alertas.create).not.toHaveBeenCalled();
  });
});
