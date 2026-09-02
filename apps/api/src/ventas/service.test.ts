import { describe, expect, it, vi } from 'vitest';
import type { TxControl, UnitOfWork } from '../db/uow.js';
import type { Repos } from '../plugins/repos.js';
import type { Producto } from '../productos/repository.js';
import type { UsuarioResumen } from '../usuarios/repository.js';
import type {
  ItemVenta,
  NuevaVenta,
  NuevoItemVenta,
  NuevoPago,
  Pago,
  Venta,
  VentasRepo,
} from './repository.js';
import {
  type AnularVentaInput,
  type ConfirmarVentaInput,
  type ItemVentaInput,
  type PagoInput,
  anularVenta,
  confirmarVenta,
  getRecibo,
  ordenarItems,
} from './service.js';

const ACTOR_ENCARGADO_ID = '00000000-0000-4000-8000-0000000000e1';
const PRODUCT_A_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_C_ID = '33333333-3333-4333-8333-333333333333';

function producto(over: Partial<Producto> = {}): Producto {
  return {
    id: PRODUCT_A_ID,
    nombre: 'Tornillo Phillips',
    sku: 'TP-001',
    categoria: null,
    stockActual: 10,
    stockMinimo: null,
    precio: '10.00',
    proveedorId: '99999999-9999-4999-8999-999999999999',
    activo: true,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

interface CallRecord {
  method: string;
  args: unknown[];
  insideTransaction: boolean;
}

interface HarnessOptions {
  productos?: Producto[];
  // productoId -> aplicarDelta return value; undefined key means "not
  // stubbed", a stubbed undefined VALUE means "aplicarDelta refused".
  aplicarDeltaResults?: Record<string, number | undefined>;
  // productoId -> revertirStockPorAnulacion return value (backlog #9).
  revertirStockPorAnulacionResults?: Record<string, number>;
  // backlog #9 (anulacion-venta) harness controls for anularVenta.
  marcarAnuladaResult?: Venta | undefined;
  findByIdResult?: Venta | undefined;
  findItemsResult?: ItemVenta[];
  revertirPagosResult?: Pago[];
  alertCreateResult?: unknown;
  alertAutoResolveResult?: unknown;
}

// Mirrors movimientos/service.test.ts's harness precedent: a UnitOfWork
// whose run() really opens/closes (transactionOpen), so a test can assert
// WHERE each call happened, and `run` itself is a vi.fn so a test can assert
// the transaction count / that it was never opened (payload-only guards).
function harness(options: HarnessOptions = {}) {
  let transactionOpen = false;
  const calls: CallRecord[] = [];

  const spy = <T>(method: string, result: (...args: never[]) => T) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, args, insideTransaction: transactionOpen });
      return result(...(args as never[]));
    });

  const productosById = new Map(
    (options.productos ?? [producto()]).map((p) => [p.id, p]),
  );

  const productos = {
    findById: spy('productos.findById', async (id: string) =>
      productosById.get(id),
    ),
    aplicarDelta: spy(
      'productos.aplicarDelta',
      async (id: string, _delta: number) => options.aplicarDeltaResults?.[id],
    ),
    revertirStockPorAnulacion: spy(
      'productos.revertirStockPorAnulacion',
      async (id: string, _cantidad: number) => {
        const result = options.revertirStockPorAnulacionResults?.[id];
        if (result === undefined) {
          throw new Error(
            `revertirStockPorAnulacion: no stubbed result for ${id}`,
          );
        }
        return result;
      },
    ),
  };

  const movimientos = {
    create: spy('movimientos.create', async (input: unknown) => ({
      id: 'mov-1',
      ...(input as object),
    })),
  };

  let ventaSeq = 0;
  let itemSeq = 0;
  let pagoSeq = 0;

  const ventas: VentasRepo = {
    create: spy('ventas.create', async (input: NuevaVenta) => {
      ventaSeq += 1;
      const venta: Venta = {
        id: `venta-${ventaSeq}`,
        numeroCorrelativo: ventaSeq,
        estado: 'confirmada',
        creadoEn: new Date('2026-01-01T00:00:00.000Z'),
        anuladaPor: null,
        anuladaEn: null,
        motivoAnulacion: null,
        ...input,
      };
      return venta;
    }) as unknown as VentasRepo['create'],
    createItems: spy('ventas.createItems', async (items: NuevoItemVenta[]) =>
      items.map((item): ItemVenta => {
        itemSeq += 1;
        return {
          id: `item-${itemSeq}`,
          ...item,
        };
      }),
    ) as unknown as VentasRepo['createItems'],
    createPagos: spy('ventas.createPagos', async (pagos: NuevoPago[]) =>
      pagos.map((pago): Pago => {
        pagoSeq += 1;
        return {
          id: `pago-${pagoSeq}`,
          estado: 'registrado',
          vuelto: pago.vuelto ?? '0',
          ...pago,
        };
      }),
    ) as unknown as VentasRepo['createPagos'],
    findById: spy(
      'ventas.findById',
      async (_id: string) => options.findByIdResult,
    ),
    findByNumeroCorrelativo: spy(
      'ventas.findByNumeroCorrelativo',
      async (_numero: number) => undefined,
    ),
    findItems: spy(
      'ventas.findItems',
      async (_ventaId: string) => options.findItemsResult ?? [],
    ),
    findPagos: spy('ventas.findPagos', async (_ventaId: string) => []),
    marcarAnulada: spy(
      'ventas.marcarAnulada',
      async (_input: unknown) => options.marcarAnuladaResult,
    ) as unknown as VentasRepo['marcarAnulada'],
    revertirPagos: spy(
      'ventas.revertirPagos',
      async (_ventaId: string) => options.revertirPagosResult ?? [],
    ),
  };

  const auditoria = { record: spy('auditoria.record', async () => {}) };

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
    ventas,
    auditoria,
    alertas,
  } as unknown as Repos & { ventas: VentasRepo };

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
        return await work(repos as unknown as Repos, tx);
      } finally {
        transactionOpen = false;
      }
    },
  );

  const uow = { run } as unknown as UnitOfWork;

  return {
    repos,
    uow,
    productos,
    movimientos,
    ventas,
    auditoria,
    alertas,
    tx,
    calls,
  };
}

function item(over: Partial<ItemVentaInput> = {}): ItemVentaInput {
  return {
    productoId: PRODUCT_A_ID,
    cantidad: 1,
    precioUnitarioEsperado: '10.00',
    ...over,
  };
}

function pago(over: Partial<PagoInput> = {}): PagoInput {
  return { medio: 'efectivo', monto: '10.00', ...over };
}

function baseInput(
  overrides: Partial<ConfirmarVentaInput> = {},
): ConfirmarVentaInput {
  return {
    items: [item()],
    pagos: [pago()],
    actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
    ...overrides,
  };
}

describe('ordenarItems', () => {
  it('sorts by productoId ascending regardless of input order', () => {
    const input = [
      item({ productoId: PRODUCT_C_ID }),
      item({ productoId: PRODUCT_A_ID }),
      item({ productoId: PRODUCT_B_ID }),
    ];

    const sorted = ordenarItems(input);

    expect(sorted.map((i) => i.productoId)).toEqual([
      PRODUCT_A_ID,
      PRODUCT_B_ID,
      PRODUCT_C_ID,
    ]);
  });

  it('does not mutate its input array', () => {
    const input = [
      item({ productoId: PRODUCT_C_ID }),
      item({ productoId: PRODUCT_A_ID }),
    ];
    const inputCopy = [...input];

    ordenarItems(input);

    expect(input).toEqual(inputCopy);
  });
});

describe('confirmarVenta — D3 deterministic order', () => {
  it('aplicarDelta call order is producto_id-ascending regardless of input order', async () => {
    const h = harness({
      productos: [
        producto({ id: PRODUCT_A_ID, precio: '10.00', stockActual: 10 }),
        producto({ id: PRODUCT_B_ID, precio: '20.00', stockActual: 10 }),
        producto({ id: PRODUCT_C_ID, precio: '30.00', stockActual: 10 }),
      ],
      aplicarDeltaResults: {
        [PRODUCT_A_ID]: 9,
        [PRODUCT_B_ID]: 9,
        [PRODUCT_C_ID]: 9,
      },
    });

    await confirmarVenta(
      h.uow,
      baseInput({
        items: [
          item({ productoId: PRODUCT_C_ID, precioUnitarioEsperado: '30.00' }),
          item({ productoId: PRODUCT_A_ID, precioUnitarioEsperado: '10.00' }),
          item({ productoId: PRODUCT_B_ID, precioUnitarioEsperado: '20.00' }),
        ],
        pagos: [pago({ monto: '60.00' })],
      }),
    );

    const aplicarDeltaCalls = h.calls.filter(
      (c) => c.method === 'productos.aplicarDelta',
    );
    expect(aplicarDeltaCalls.map((c) => c.args[0])).toEqual([
      PRODUCT_A_ID,
      PRODUCT_B_ID,
      PRODUCT_C_ID,
    ]);
  });
});

describe('confirmarVenta — D5/D12 price authority', () => {
  it('a stale price is not silently accepted and lists every mismatched line', async () => {
    const h = harness({
      productos: [
        producto({ id: PRODUCT_A_ID, precio: '11.00' }),
        producto({ id: PRODUCT_B_ID, precio: '20.00' }),
        producto({ id: PRODUCT_C_ID, precio: '31.00' }),
      ],
      aplicarDeltaResults: {
        [PRODUCT_A_ID]: 9,
        [PRODUCT_B_ID]: 9,
        [PRODUCT_C_ID]: 9,
      },
    });

    await expect(
      confirmarVenta(
        h.uow,
        baseInput({
          items: [
            item({ productoId: PRODUCT_A_ID, precioUnitarioEsperado: '10.00' }),
            item({ productoId: PRODUCT_B_ID, precioUnitarioEsperado: '20.00' }),
            item({ productoId: PRODUCT_C_ID, precioUnitarioEsperado: '30.00' }),
          ],
          pagos: [pago({ monto: '61.00' })],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'PRICE_CHANGED',
      status: 409,
      details: {
        items: [
          {
            productoId: PRODUCT_A_ID,
            precioEsperado: '10.00',
            precioActual: '11.00',
          },
          {
            productoId: PRODUCT_C_ID,
            precioEsperado: '30.00',
            precioActual: '31.00',
          },
        ],
      },
    });

    expect(h.ventas.create).not.toHaveBeenCalled();
    expect(h.movimientos.create).not.toHaveBeenCalled();
  });

  it('the persisted price is the server current price, not the client value', async () => {
    const h = harness({
      productos: [producto({ id: PRODUCT_A_ID, precio: '10.00' })],
      aplicarDeltaResults: { [PRODUCT_A_ID]: 9 },
    });

    await confirmarVenta(
      h.uow,
      baseInput({
        items: [
          item({ productoId: PRODUCT_A_ID, precioUnitarioEsperado: '10.00' }),
        ],
        pagos: [pago({ monto: '10.00' })],
      }),
    );

    expect(h.ventas.createItems).toHaveBeenCalledWith([
      expect.objectContaining({ precioUnitario: '10.00', subtotal: '10.00' }),
    ]);
  });
});

describe('confirmarVenta — PD-1/PD-10 payment validation', () => {
  it('payments summing below the total are refused before any write', async () => {
    const h = harness({
      productos: [producto({ id: PRODUCT_A_ID, precio: '100.00' })],
    });

    await expect(
      confirmarVenta(
        h.uow,
        baseInput({
          items: [
            item({
              productoId: PRODUCT_A_ID,
              precioUnitarioEsperado: '100.00',
            }),
          ],
          pagos: [pago({ monto: '80.00' })],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'PAYMENT_BELOW_TOTAL',
      status: 409,
      details: { total: '100.00', pagado: '80.00' },
    });

    expect(h.ventas.create).not.toHaveBeenCalled();
    expect(h.movimientos.create).not.toHaveBeenCalled();
  });

  it('card-only payment exceeding the total is refused (no cash row to carry the excess)', async () => {
    const h = harness({
      productos: [producto({ id: PRODUCT_A_ID, precio: '100.00' })],
    });

    await expect(
      confirmarVenta(
        h.uow,
        baseInput({
          items: [
            item({
              productoId: PRODUCT_A_ID,
              precioUnitarioEsperado: '100.00',
            }),
          ],
          pagos: [pago({ medio: 'tarjeta', monto: '110.00' })],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'CASHLESS_PAYMENT_MUST_MATCH_TOTAL',
      status: 409,
    });

    expect(h.ventas.create).not.toHaveBeenCalled();
  });

  it('PD-10: non-cash sum exceeding the total is refused even with a cash row present', async () => {
    const h = harness({
      productos: [producto({ id: PRODUCT_A_ID, precio: '100.00' })],
    });

    await expect(
      confirmarVenta(
        h.uow,
        baseInput({
          items: [
            item({
              productoId: PRODUCT_A_ID,
              precioUnitarioEsperado: '100.00',
            }),
          ],
          pagos: [
            pago({ medio: 'tarjeta', monto: '120.00' }),
            pago({ medio: 'efectivo', monto: '5.00' }),
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'CASHLESS_PAYMENT_MUST_MATCH_TOTAL',
      status: 409,
    });

    expect(h.ventas.create).not.toHaveBeenCalled();
  });

  it('split payment summing exactly to the total succeeds', async () => {
    const h = harness({
      productos: [producto({ id: PRODUCT_A_ID, precio: '100.00' })],
      aplicarDeltaResults: { [PRODUCT_A_ID]: 9 },
    });

    await expect(
      confirmarVenta(
        h.uow,
        baseInput({
          items: [
            item({
              productoId: PRODUCT_A_ID,
              precioUnitarioEsperado: '100.00',
            }),
          ],
          pagos: [
            pago({ medio: 'efectivo', monto: '40.00' }),
            pago({ medio: 'tarjeta', monto: '60.00' }),
          ],
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe('confirmarVenta — D6/PD-2 vuelto restricted to the cash row', () => {
  it('cash overpayment produces vuelto on the cash row only', async () => {
    const h = harness({
      productos: [producto({ id: PRODUCT_A_ID, precio: '90.00' })],
      aplicarDeltaResults: { [PRODUCT_A_ID]: 9 },
    });

    await confirmarVenta(
      h.uow,
      baseInput({
        items: [
          item({ productoId: PRODUCT_A_ID, precioUnitarioEsperado: '90.00' }),
        ],
        pagos: [
          pago({ medio: 'tarjeta', monto: '40.00' }),
          pago({ medio: 'efectivo', monto: '60.00' }),
        ],
      }),
    );

    expect(h.ventas.createPagos).toHaveBeenCalledWith([
      expect.objectContaining({
        medio: 'tarjeta',
        monto: '40.00',
        vuelto: '0',
      }),
      expect.objectContaining({
        medio: 'efectivo',
        monto: '60.00',
        vuelto: '10.00',
      }),
    ]);
  });
});

describe('confirmarVenta — D13/RECONCILE-1 duplicate refusal', () => {
  it('a duplicate productoId in the request is refused, never merged, before any transaction opens', async () => {
    const h = harness();

    await expect(
      confirmarVenta(
        h.uow,
        baseInput({
          items: [
            item({ productoId: PRODUCT_A_ID }),
            item({ productoId: PRODUCT_A_ID }),
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_SALE_ITEM', status: 400 });

    expect(h.uow.run).not.toHaveBeenCalled();
  });

  it('two payment rows sharing a medio are refused, before any transaction opens', async () => {
    const h = harness();

    await expect(
      confirmarVenta(
        h.uow,
        baseInput({
          pagos: [
            pago({ medio: 'efectivo', monto: '5.00' }),
            pago({ medio: 'efectivo', monto: '5.00' }),
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_MEDIUM_DUPLICATED', status: 400 });

    expect(h.uow.run).not.toHaveBeenCalled();
  });
});

describe('confirmarVenta — D4 classification on aplicarDelta undefined', () => {
  it('product gone -> PRODUCT_NOT_FOUND (classified from Pass A, never reached Pass B without a row)', async () => {
    const h = harness({ productos: [] });

    await expect(confirmarVenta(h.uow, baseInput())).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
      status: 404,
    });
  });

  it('inactive product -> PRODUCT_INACTIVE', async () => {
    const h = harness({
      productos: [producto({ id: PRODUCT_A_ID, activo: false })],
    });

    await expect(confirmarVenta(h.uow, baseInput())).rejects.toMatchObject({
      code: 'PRODUCT_INACTIVE',
      status: 409,
    });
  });

  it('insufficient stock -> INSUFFICIENT_STOCK carrying the READ stock, no items/pagos row persisted', async () => {
    const h = harness({
      productos: [
        producto({ id: PRODUCT_A_ID, precio: '10.00', stockActual: 3 }),
      ],
      aplicarDeltaResults: { [PRODUCT_A_ID]: undefined },
    });

    await expect(
      confirmarVenta(
        h.uow,
        baseInput({
          items: [
            item({
              productoId: PRODUCT_A_ID,
              cantidad: 5,
              precioUnitarioEsperado: '10.00',
            }),
          ],
          pagos: [pago({ monto: '50.00' })],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      status: 409,
      details: { available: 3 },
    });

    expect(h.ventas.createItems).not.toHaveBeenCalled();
    expect(h.ventas.createPagos).not.toHaveBeenCalled();
  });
});

describe('confirmarVenta — atomicity and ledger shape', () => {
  it('invokes uow.run exactly once per successful call', async () => {
    const h = harness({
      productos: [producto({ id: PRODUCT_A_ID, precio: '10.00' })],
      aplicarDeltaResults: { [PRODUCT_A_ID]: 9 },
    });

    await confirmarVenta(h.uow, baseInput());

    expect(h.uow.run).toHaveBeenCalledTimes(1);
  });

  it('produces one movimientos row per item with tipo venta and the confirmed ventaId', async () => {
    const h = harness({
      productos: [
        producto({ id: PRODUCT_A_ID, precio: '10.00' }),
        producto({ id: PRODUCT_B_ID, precio: '20.00' }),
      ],
      aplicarDeltaResults: { [PRODUCT_A_ID]: 9, [PRODUCT_B_ID]: 9 },
    });

    await confirmarVenta(
      h.uow,
      baseInput({
        items: [
          item({ productoId: PRODUCT_A_ID, precioUnitarioEsperado: '10.00' }),
          item({ productoId: PRODUCT_B_ID, precioUnitarioEsperado: '20.00' }),
        ],
        pagos: [pago({ monto: '30.00' })],
      }),
    );

    expect(h.movimientos.create).toHaveBeenCalledTimes(2);
    expect(h.movimientos.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'venta',
        ventaId: 'venta-1',
        cantidad: -1,
      }),
    );
  });
});

// Phase 2 (backlog #10), task 2.7 / D3: one savepoint PER ITEM, not one
// per sale. An item 2 evaluator failure must not block items 1/3 from
// getting their own alerts.
describe('confirmarVenta — alert evaluator wiring (D3: per-item savepoint)', () => {
  it('invokes tx.savepoint once per item, using each item Pass-A producto stockMinimo snapshot', async () => {
    const h = harness({
      productos: [
        producto({ id: PRODUCT_A_ID, precio: '10.00', stockMinimo: 5 }),
        producto({ id: PRODUCT_B_ID, precio: '20.00', stockMinimo: null }),
      ],
      // A: previo=8 (resultante 3 - cantidad -5) below stockMinimo=5 ->
      // stock_bajo. B: stockMinimo null -> never fires.
      aplicarDeltaResults: { [PRODUCT_A_ID]: 3, [PRODUCT_B_ID]: 9 },
    });

    await confirmarVenta(
      h.uow,
      baseInput({
        items: [
          item({
            productoId: PRODUCT_A_ID,
            cantidad: 5,
            precioUnitarioEsperado: '10.00',
          }),
          item({
            productoId: PRODUCT_B_ID,
            cantidad: 1,
            precioUnitarioEsperado: '20.00',
          }),
        ],
        pagos: [pago({ monto: '70.00' })],
      }),
    );

    expect(h.tx.savepoint).toHaveBeenCalledTimes(2);
    expect(h.alertas.create).toHaveBeenCalledWith(
      expect.objectContaining({ productoId: PRODUCT_A_ID, tipo: 'stock_bajo' }),
    );
  });

  it("item 2's evaluator failure does not block items 1/3 from getting their alerts (savepoint isolates per item)", async () => {
    const PRODUCT_D_ID = '44444444-4444-4444-8444-444444444444';
    const h = harness({
      productos: [
        producto({ id: PRODUCT_A_ID, precio: '10.00', stockMinimo: 5 }),
        producto({ id: PRODUCT_B_ID, precio: '20.00', stockMinimo: 5 }),
        producto({ id: PRODUCT_D_ID, precio: '5.00', stockMinimo: 5 }),
      ],
      aplicarDeltaResults: {
        [PRODUCT_A_ID]: 3,
        [PRODUCT_B_ID]: 3,
        [PRODUCT_D_ID]: 3,
      },
    });
    // Item 2 (PRODUCT_B_ID)'s alertas.create throws — the fake tx.savepoint
    // swallows it (mirrors the real never-rethrow contract), so items 1/3
    // still reach their own alertas.create call.
    h.alertas.create.mockImplementation(async (input: unknown) => {
      const typed = input as { productoId: string };
      if (typed.productoId === PRODUCT_B_ID) {
        throw new Error('boom: simulated evaluator SQL failure for item 2');
      }
      return undefined;
    });

    await confirmarVenta(
      h.uow,
      baseInput({
        items: [
          item({
            productoId: PRODUCT_A_ID,
            cantidad: 5,
            precioUnitarioEsperado: '10.00',
          }),
          item({
            productoId: PRODUCT_B_ID,
            cantidad: 5,
            precioUnitarioEsperado: '20.00',
          }),
          item({
            productoId: PRODUCT_D_ID,
            cantidad: 5,
            precioUnitarioEsperado: '5.00',
          }),
        ],
        pagos: [pago({ monto: '175.00' })],
      }),
    );

    const productoIdsAttempted = h.alertas.create.mock.calls.map(
      (call) => (call[0] as { productoId: string }).productoId,
    );
    expect(productoIdsAttempted).toEqual([
      PRODUCT_A_ID,
      PRODUCT_B_ID,
      PRODUCT_D_ID,
    ]);
    expect(h.tx.savepoint).toHaveBeenCalledTimes(3);
  });
});

// backlog #9 (anulacion-venta) — tasks.md 3.2, design.md's Technical
// Approach ("confirmarVenta's mirror image").
const ANULACION_VENTA_ID = 'venta-1';

describe('anularVenta — no partial-selection param exists on the signature', () => {
  it('AnularVentaInput has no item/pago selection key at the type level', () => {
    const input: AnularVentaInput = {
      ventaId: ANULACION_VENTA_ID,
      actorId: ACTOR_ENCARGADO_ID,
      motivoAnulacion: 'Cliente canceló el pedido',
      // @ts-expect-error — no itemIds/pagoIds selection key exists
      itemIds: ['item-1'],
    };
    expect(input).toBeDefined();
  });
});

describe('anularVenta — PD-1 mandatory motivo, refused before any write', () => {
  it.each(['', '  ', 'ab', 'a'.repeat(501)])(
    'refuses %j before uow.run ever opens, with VALIDATION_ERROR 400',
    async (motivoAnulacion) => {
      const h = harness();

      await expect(
        anularVenta(h.uow, {
          ventaId: ANULACION_VENTA_ID,
          actorId: ACTOR_ENCARGADO_ID,
          motivoAnulacion,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

      expect(h.uow.run).not.toHaveBeenCalled();
    },
  );

  it('accepts a motivo at exactly the 3-char floor and the 500-char ceiling', async () => {
    const itemA = itemVenta({
      id: 'item-1',
      ventaId: ANULACION_VENTA_ID,
      productoId: PRODUCT_A_ID,
      cantidad: 2,
    });
    const h = harness({
      marcarAnuladaResult: venta({
        id: ANULACION_VENTA_ID,
        estado: 'anulada',
        anuladaPor: ACTOR_ENCARGADO_ID,
        anuladaEn: new Date('2026-01-02T00:00:00.000Z'),
        motivoAnulacion: 'abc',
      }),
      findItemsResult: [itemA],
      revertirStockPorAnulacionResults: { [PRODUCT_A_ID]: 12 },
    });

    await expect(
      anularVenta(h.uow, {
        ventaId: ANULACION_VENTA_ID,
        actorId: ACTOR_ENCARGADO_ID,
        motivoAnulacion: 'abc',
      }),
    ).resolves.toBeDefined();

    const h2 = harness({
      marcarAnuladaResult: venta({
        id: ANULACION_VENTA_ID,
        estado: 'anulada',
        motivoAnulacion: 'a'.repeat(500),
      }),
      findItemsResult: [itemA],
      revertirStockPorAnulacionResults: { [PRODUCT_A_ID]: 12 },
    });

    await expect(
      anularVenta(h2.uow, {
        ventaId: ANULACION_VENTA_ID,
        actorId: ACTOR_ENCARGADO_ID,
        motivoAnulacion: 'a'.repeat(500),
      }),
    ).resolves.toBeDefined();
  });
});

describe('anularVenta — D2 transition-first ordering (design.md serialization point)', () => {
  it('calls marcarAnulada BEFORE any productos.revertirStockPorAnulacion / movimientos.create / revertirPagos call', async () => {
    const itemA = itemVenta({
      id: 'item-1',
      ventaId: ANULACION_VENTA_ID,
      productoId: PRODUCT_A_ID,
      cantidad: 2,
    });
    const itemB = itemVenta({
      id: 'item-2',
      ventaId: ANULACION_VENTA_ID,
      productoId: PRODUCT_B_ID,
      cantidad: 3,
    });
    const h = harness({
      productos: [
        producto({ id: PRODUCT_A_ID }),
        producto({ id: PRODUCT_B_ID }),
      ],
      marcarAnuladaResult: venta({
        id: ANULACION_VENTA_ID,
        estado: 'anulada',
        anuladaPor: ACTOR_ENCARGADO_ID,
        anuladaEn: new Date('2026-01-02T00:00:00.000Z'),
        motivoAnulacion: 'Cliente canceló el pedido',
      }),
      findItemsResult: [itemA, itemB],
      revertirStockPorAnulacionResults: {
        [PRODUCT_A_ID]: 12,
        [PRODUCT_B_ID]: 13,
      },
      revertirPagosResult: [pagoRow({ estado: 'revertido' })],
    });

    await anularVenta(h.uow, {
      ventaId: ANULACION_VENTA_ID,
      actorId: ACTOR_ENCARGADO_ID,
      motivoAnulacion: 'Cliente canceló el pedido',
    });

    const methodOrder = h.calls.map((c) => c.method);
    const marcarIdx = methodOrder.indexOf('ventas.marcarAnulada');
    const stockIdx = methodOrder.indexOf('productos.revertirStockPorAnulacion');
    const movIdx = methodOrder.indexOf('movimientos.create');
    const pagosIdx = methodOrder.indexOf('ventas.revertirPagos');

    expect(marcarIdx).toBe(0);
    expect(marcarIdx).toBeLessThan(stockIdx);
    expect(marcarIdx).toBeLessThan(movIdx);
    expect(stockIdx).toBeLessThan(pagosIdx);
    expect(movIdx).toBeLessThan(pagosIdx);
    expect(h.uow.run).toHaveBeenCalledTimes(1);
  });

  it('persists motivoAnulacion verbatim through marcarAnulada', async () => {
    const itemA = itemVenta({ productoId: PRODUCT_A_ID, cantidad: 1 });
    const h = harness({
      marcarAnuladaResult: venta({ id: ANULACION_VENTA_ID, estado: 'anulada' }),
      findItemsResult: [itemA],
      revertirStockPorAnulacionResults: { [PRODUCT_A_ID]: 10 },
    });

    await anularVenta(h.uow, {
      ventaId: ANULACION_VENTA_ID,
      actorId: ACTOR_ENCARGADO_ID,
      motivoAnulacion: 'Cliente canceló el pedido',
    });

    expect(h.ventas.marcarAnulada).toHaveBeenCalledWith({
      ventaId: ANULACION_VENTA_ID,
      anuladaPor: ACTOR_ENCARGADO_ID,
      motivoAnulacion: 'Cliente canceló el pedido',
    });
  });

  it('creates one movimientos row per item, tipo anulacion, positive cantidad, motivo null, linked by ventaId', async () => {
    const itemA = itemVenta({
      id: 'item-1',
      productoId: PRODUCT_A_ID,
      cantidad: 4,
    });
    const h = harness({
      marcarAnuladaResult: venta({ id: ANULACION_VENTA_ID, estado: 'anulada' }),
      findItemsResult: [itemA],
      revertirStockPorAnulacionResults: { [PRODUCT_A_ID]: 20 },
    });

    await anularVenta(h.uow, {
      ventaId: ANULACION_VENTA_ID,
      actorId: ACTOR_ENCARGADO_ID,
      motivoAnulacion: 'Cliente canceló el pedido',
    });

    expect(h.movimientos.create).toHaveBeenCalledWith(
      expect.objectContaining({
        productoId: PRODUCT_A_ID,
        tipo: 'anulacion',
        cantidad: 4,
        motivo: null,
        ventaId: ANULACION_VENTA_ID,
        stockResultante: 20,
      }),
    );
  });
});

describe('anularVenta — D4 classify-on-undefined (rechazarVenta precedent)', () => {
  it('marcarAnulada undefined + findById absent -> saleNotFound() (404)', async () => {
    const h = harness({
      marcarAnuladaResult: undefined,
      findByIdResult: undefined,
    });

    await expect(
      anularVenta(h.uow, {
        ventaId: ANULACION_VENTA_ID,
        actorId: ACTOR_ENCARGADO_ID,
        motivoAnulacion: 'Motivo cualquiera',
      }),
    ).rejects.toMatchObject({ code: 'SALE_NOT_FOUND', status: 404 });
  });

  it('marcarAnulada undefined + findById present -> saleAlreadyVoided() (409)', async () => {
    const h = harness({
      marcarAnuladaResult: undefined,
      findByIdResult: venta({ id: ANULACION_VENTA_ID, estado: 'anulada' }),
    });

    await expect(
      anularVenta(h.uow, {
        ventaId: ANULACION_VENTA_ID,
        actorId: ACTOR_ENCARGADO_ID,
        motivoAnulacion: 'Motivo cualquiera',
      }),
    ).rejects.toMatchObject({ code: 'SALE_ALREADY_VOIDED', status: 409 });

    expect(h.productos.revertirStockPorAnulacion).not.toHaveBeenCalled();
    expect(h.movimientos.create).not.toHaveBeenCalled();
  });
});

describe('anularVenta — total reversal, every item and every pago (v1, not partial)', () => {
  it('reverses every item and every pago row, none held back', async () => {
    const itemA = itemVenta({
      id: 'item-1',
      productoId: PRODUCT_A_ID,
      cantidad: 1,
    });
    const itemB = itemVenta({
      id: 'item-2',
      productoId: PRODUCT_B_ID,
      cantidad: 2,
    });
    const itemC = itemVenta({
      id: 'item-3',
      productoId: PRODUCT_C_ID,
      cantidad: 3,
    });
    const h = harness({
      productos: [
        producto({ id: PRODUCT_A_ID }),
        producto({ id: PRODUCT_B_ID }),
        producto({ id: PRODUCT_C_ID }),
      ],
      marcarAnuladaResult: venta({ id: ANULACION_VENTA_ID, estado: 'anulada' }),
      findItemsResult: [itemA, itemB, itemC],
      revertirStockPorAnulacionResults: {
        [PRODUCT_A_ID]: 1,
        [PRODUCT_B_ID]: 2,
        [PRODUCT_C_ID]: 3,
      },
      revertirPagosResult: [
        pagoRow({ id: 'pago-1', estado: 'revertido' }),
        pagoRow({ id: 'pago-2', estado: 'revertido' }),
      ],
    });

    const result = await anularVenta(h.uow, {
      ventaId: ANULACION_VENTA_ID,
      actorId: ACTOR_ENCARGADO_ID,
      motivoAnulacion: 'Cliente canceló el pedido',
    });

    expect(h.productos.revertirStockPorAnulacion).toHaveBeenCalledTimes(3);
    expect(h.movimientos.create).toHaveBeenCalledTimes(3);
    expect(h.ventas.revertirPagos).toHaveBeenCalledTimes(1);
    expect(result.pagos).toHaveLength(2);
  });
});

// Phase 2 (backlog #10), task 2.8 / D3: invoked per item, inside the item
// loop, after each movimientos.create — no `tipo === 'anulacion'` special
// case (the generic crossing rule already yields resolve-only behaviour,
// since revertirStockPorAnulacion only ever adds positive quantities).
describe('anularVenta — alert evaluator wiring (D3, generic crossing rule)', () => {
  it('invokes tx.savepoint once per item and auto-resolves quiebre when stock is restored above zero', async () => {
    const itemA = itemVenta({
      id: 'item-1',
      ventaId: ANULACION_VENTA_ID,
      productoId: PRODUCT_A_ID,
      cantidad: 5,
    });
    const h = harness({
      productos: [producto({ id: PRODUCT_A_ID, stockMinimo: null })],
      marcarAnuladaResult: venta({ id: ANULACION_VENTA_ID, estado: 'anulada' }),
      findItemsResult: [itemA],
      // previo = stockResultante - cantidad = 5 - 5 = 0 -> quiebre auto-resolve
      revertirStockPorAnulacionResults: { [PRODUCT_A_ID]: 5 },
    });

    await anularVenta(h.uow, {
      ventaId: ANULACION_VENTA_ID,
      actorId: ACTOR_ENCARGADO_ID,
      motivoAnulacion: 'Cliente canceló el pedido',
    });

    expect(h.tx.savepoint).toHaveBeenCalledTimes(1);
    expect(h.alertas.autoResolve).toHaveBeenCalledWith(PRODUCT_A_ID, 'quiebre');
  });

  it('invokes tx.savepoint once per item across a multi-item anulación', async () => {
    const itemA = itemVenta({
      id: 'item-1',
      productoId: PRODUCT_A_ID,
      cantidad: 2,
    });
    const itemB = itemVenta({
      id: 'item-2',
      productoId: PRODUCT_B_ID,
      cantidad: 3,
    });
    const h = harness({
      productos: [
        producto({ id: PRODUCT_A_ID }),
        producto({ id: PRODUCT_B_ID }),
      ],
      marcarAnuladaResult: venta({ id: ANULACION_VENTA_ID, estado: 'anulada' }),
      findItemsResult: [itemA, itemB],
      revertirStockPorAnulacionResults: {
        [PRODUCT_A_ID]: 12,
        [PRODUCT_B_ID]: 13,
      },
    });

    await anularVenta(h.uow, {
      ventaId: ANULACION_VENTA_ID,
      actorId: ACTOR_ENCARGADO_ID,
      motivoAnulacion: 'Cliente canceló el pedido',
    });

    expect(h.tx.savepoint).toHaveBeenCalledTimes(2);
  });
});

// recibo-interno (backlog #8) — tasks.md Task 1.3, design.md D2/D7.
const CAJERO_ID = '44444444-4444-4444-8444-444444444444';

function venta(over: Partial<Venta> = {}): Venta {
  return {
    id: 'venta-1',
    numeroCorrelativo: 1,
    usuarioId: CAJERO_ID,
    estado: 'confirmada',
    total: '10.00',
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    anuladaPor: null,
    anuladaEn: null,
    motivoAnulacion: null,
    ...over,
  };
}

function itemVenta(over: Partial<ItemVenta> = {}): ItemVenta {
  return {
    id: 'item-1',
    ventaId: 'venta-1',
    productoId: PRODUCT_A_ID,
    cantidad: 1,
    precioUnitario: '10.00',
    subtotal: '10.00',
    ...over,
  };
}

function pagoRow(over: Partial<Pago> = {}): Pago {
  return {
    id: 'pago-1',
    ventaId: 'venta-1',
    medio: 'efectivo',
    monto: '10.00',
    vuelto: '0',
    estado: 'registrado',
    ...over,
  };
}

function usuarioResumen(over: Partial<UsuarioResumen> = {}): UsuarioResumen {
  return {
    id: CAJERO_ID,
    nombre: 'Cajera Uno',
    email: 'cajera@example.com',
    rol: 'encargado',
    activo: true,
    debeCambiarPassword: false,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

interface ReciboHarnessOptions {
  venta?: Venta | undefined;
  items?: ItemVenta[];
  pagos?: Pago[];
  usuario?: UsuarioResumen | undefined;
  productos?: Producto[];
}

function reciboHarness(options: ReciboHarnessOptions = {}) {
  const ventaRow =
    options.venta === undefined && !('venta' in options)
      ? venta()
      : options.venta;
  const items = options.items ?? [itemVenta()];
  const pagosRows = options.pagos ?? [pagoRow()];
  const usuario =
    options.usuario === undefined && !('usuario' in options)
      ? usuarioResumen()
      : options.usuario;
  const productosById = new Map(
    (options.productos ?? [producto()]).map((p) => [p.id, p]),
  );

  const ventas = {
    findById: vi.fn(async (_id: string) => ventaRow),
    findByNumeroCorrelativo: vi.fn(
      async (_numeroCorrelativo: number) => ventaRow,
    ),
    findItems: vi.fn(async (_ventaId: string) => items),
    findPagos: vi.fn(async (_ventaId: string) => pagosRows),
  } as unknown as VentasRepo;

  const usuarios = {
    findById: vi.fn(async (_id: string) => usuario),
  };

  const productos = {
    findById: vi.fn(async (id: string) => productosById.get(id)),
  };

  const repos = { ventas, usuarios, productos } as unknown as Repos;

  return { repos, ventas, usuarios, productos };
}

describe('getRecibo — not found (design.md D2, both selectors)', () => {
  it('throws saleNotFound() (SALE_NOT_FOUND, 404) when no venta matches the id', async () => {
    const h = reciboHarness({ venta: undefined });

    await expect(getRecibo(h.repos, { id: 'nope' })).rejects.toMatchObject({
      code: 'SALE_NOT_FOUND',
      status: 404,
    });
  });

  it('throws saleNotFound() (SALE_NOT_FOUND, 404) when no venta matches the numeroCorrelativo', async () => {
    const h = reciboHarness({ venta: undefined });

    await expect(
      getRecibo(h.repos, { numeroCorrelativo: 999 }),
    ).rejects.toMatchObject({
      code: 'SALE_NOT_FOUND',
      status: 404,
    });
  });
});

describe('getRecibo — composes cajero and per-item current names (design.md D7)', () => {
  it('resolves the cajero via UsuariosRepo.findById and every item via ProductosRepo.findById', async () => {
    const h = reciboHarness({
      usuario: usuarioResumen({ nombre: 'Cajera Actual' }),
      productos: [producto({ id: PRODUCT_A_ID, nombre: 'Nombre Actual' })],
      items: [itemVenta({ productoId: PRODUCT_A_ID })],
    });

    const recibo = await getRecibo(h.repos, { id: 'venta-1' });

    expect(h.usuarios.findById).toHaveBeenCalledWith(CAJERO_ID);
    expect(h.productos.findById).toHaveBeenCalledWith(PRODUCT_A_ID);
    expect(recibo.cajero).toMatchObject({
      id: CAJERO_ID,
      nombre: 'Cajera Actual',
    });
    expect(recibo.items[0]).toMatchObject({
      productoId: PRODUCT_A_ID,
      nombre: 'Nombre Actual',
    });
  });
});

describe('getRecibo — returns every pagos row unfiltered (PROD-F, deferred)', () => {
  it('includes a revertido row without filtering it out', async () => {
    const h = reciboHarness({
      pagos: [
        pagoRow({ id: 'pago-1', estado: 'registrado' }),
        pagoRow({ id: 'pago-2', estado: 'revertido' }),
      ],
    });

    const recibo = await getRecibo(h.repos, { id: 'venta-1' });

    expect(recibo.pagos).toHaveLength(2);
    expect(recibo.pagos.map((p) => p.estado)).toEqual([
      'registrado',
      'revertido',
    ]);
  });
});

describe('getRecibo — estado passes through verbatim (design.md D2)', () => {
  it.each(['confirmada', 'anulada'] as const)(
    'returns estado %s unchanged',
    async (estado) => {
      const h = reciboHarness({ venta: venta({ estado }) });

      const recibo = await getRecibo(h.repos, { id: 'venta-1' });

      expect(recibo.venta.estado).toBe(estado);
    },
  );
});
