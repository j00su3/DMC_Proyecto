import { describe, expect, it, vi } from 'vitest';
import type { UnitOfWork } from '../db/uow.js';
import type { Repos } from '../plugins/repos.js';
import type { Producto } from '../productos/repository.js';
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
  type ConfirmarVentaInput,
  type ItemVentaInput,
  type PagoInput,
  confirmarVenta,
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
  };

  const repos = { productos, movimientos, ventas } as unknown as Repos & {
    ventas: VentasRepo;
  };

  const run = vi.fn(async (work: (repos: Repos) => Promise<unknown>) => {
    transactionOpen = true;
    try {
      return await work(repos as unknown as Repos);
    } finally {
      transactionOpen = false;
    }
  });

  const uow = { run } as unknown as UnitOfWork;

  return { repos, uow, productos, movimientos, ventas, calls };
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
