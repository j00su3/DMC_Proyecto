import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { UnitOfWork } from '../db/uow.js';
import type { MovimientosRepo } from '../movimientos/repository.js';
import type { Repos } from '../plugins/repos.js';
import type { Producto, ProductosRepo } from '../productos/repository.js';
import type {
  Usuario,
  UsuarioResumen,
  UsuariosRepo,
} from '../usuarios/repository.js';
import type {
  ItemVenta,
  NuevaVenta,
  NuevoItemVenta,
  NuevoPago,
  Pago,
  Venta,
  VentasRepo,
} from '../ventas/repository.js';

// routes/ventas.ts (task 3.3) exercised through the REAL buildApp, same
// technique as routes/movimientos.test.ts — a divergence in registration
// order/config cannot hide behind a local copy of the plugin wiring.

const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
// The fakes below never use the URL's :id to select a row — every route
// test that reaches the handler returns makeVenta() regardless. This
// constant only has to satisfy `idParams`'s `z.string().uuid()`.
const VALID_VENTA_UUID = '55555555-5555-4555-8555-555555555555';

function makeUsuario(overrides: Partial<Usuario> = {}): Usuario {
  return {
    id: 'u1',
    nombre: 'Test User',
    email: 'test@example.com',
    hashContrasena: 'irrelevant-hash',
    rol: 'encargado',
    activo: true,
    intentosFallidos: 0,
    bloqueadoHasta: null,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    debeCambiarPassword: false,
    ...overrides,
  };
}

function makeProducto(overrides: Partial<Producto> = {}): Producto {
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
    ...overrides,
  };
}

function makeVenta(overrides: Partial<Venta> = {}): Venta {
  return {
    id: 'venta-1',
    numeroCorrelativo: 1,
    usuarioId: 'u1',
    estado: 'confirmada',
    total: '10.00',
    creadoEn: new Date('2026-02-01T00:00:00.000Z'),
    anuladaPor: null,
    anuladaEn: null,
    motivoAnulacion: null,
    ...overrides,
  };
}

function makeItemVenta(overrides: Partial<ItemVenta> = {}): ItemVenta {
  return {
    id: 'item-1',
    ventaId: 'venta-1',
    productoId: PRODUCT_ID,
    cantidad: 1,
    precioUnitario: '10.00',
    subtotal: '10.00',
    ...overrides,
  };
}

function makePago(overrides: Partial<Pago> = {}): Pago {
  return {
    id: 'pago-1',
    ventaId: 'venta-1',
    medio: 'efectivo',
    monto: '10.00',
    vuelto: '0',
    estado: 'registrado',
    ...overrides,
  };
}

const CAJERO_ID = 'u1';

function makeUsuarioResumen(
  overrides: Partial<UsuarioResumen> = {},
): UsuarioResumen {
  return {
    id: CAJERO_ID,
    nombre: 'Test User',
    email: 'test@example.com',
    rol: 'encargado',
    activo: true,
    debeCambiarPassword: false,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

// recibo-interno (backlog #8): the only member these route tests ever
// exercise on UsuariosRepo is findById (the cajero-name composition).
// Everything else stays unreachable-by-construction, same technique as
// app.test.ts's unusedRepoMethod.
function unusedUsuariosMethod(): never {
  throw new Error(
    'routes/ventas.test.ts fake: this UsuariosRepo method is outside this suite',
  );
}

function fakeUsuariosRepo(overrides: Partial<UsuariosRepo> = {}): UsuariosRepo {
  return {
    findByEmail: unusedUsuariosMethod,
    registerFailedAttempt: unusedUsuariosMethod,
    resetAttempts: unusedUsuariosMethod,
    updatePassword: unusedUsuariosMethod,
    list: unusedUsuariosMethod,
    findById: async () => makeUsuarioResumen(),
    findByIdForUpdate: unusedUsuariosMethod,
    lockActiveEncargados: unusedUsuariosMethod,
    findLockoutState: unusedUsuariosMethod,
    create: unusedUsuariosMethod,
    update: unusedUsuariosMethod,
    setActivo: unusedUsuariosMethod,
    resetPassword: unusedUsuariosMethod,
    ...overrides,
  };
}

interface Spies {
  aplicarDeltaCalls: unknown[][];
  movimientosCreateCalls: unknown[][];
  ventasCreateCalls: unknown[][];
  productosListCalls: unknown[][];
  revertirStockPorAnulacionCalls: unknown[][];
  marcarAnuladaCalls: unknown[][];
  revertirPagosCalls: unknown[][];
}

function fakeRepos(
  spies: Spies,
  productosOverrides: Partial<ProductosRepo> = {},
  ventasOverrides: Partial<VentasRepo> = {},
  sesionesOverrides: Partial<SesionesRepo> = {},
  usuariosOverrides: Partial<UsuariosRepo> = {},
) {
  return {
    usuarios: fakeUsuariosRepo(usuariosOverrides),
    sesiones: {
      create: async () => {},
      findValid: async () => undefined,
      delete: async () => {},
      purgeExpired: async () => {},
      deleteOthers: async () => {},
      deleteAllForUser: async () => {},
      ...sesionesOverrides,
    } as SesionesRepo,
    auditoria: { record: async () => {} } as AuditoriaRepo,
    proveedores: {} as never,
    productos: {
      list: async (...args: unknown[]) => {
        spies.productosListCalls.push(args);
        return { rows: [], total: 0 };
      },
      findById: async () => makeProducto(),
      findByIdForUpdate: async () => makeProducto(),
      create: async () => makeProducto(),
      update: async () => makeProducto(),
      setActivo: async () => makeProducto(),
      aplicarDelta: async (...args: unknown[]) => {
        spies.aplicarDeltaCalls.push(args);
        return 9;
      },
      revertirStockPorAnulacion: async (...args: unknown[]) => {
        spies.revertirStockPorAnulacionCalls.push(args);
        return 9;
      },
      ...productosOverrides,
    } as ProductosRepo,
    movimientos: {
      create: async (...args: unknown[]) => {
        spies.movimientosCreateCalls.push(args);
        return {
          id: 'mov-1',
          productoId: PRODUCT_ID,
          tipo: 'venta',
          cantidad: -1,
          motivo: null,
          esDiscrepancia: false,
          esMerma: false,
          usuarioId: 'u1',
          fecha: new Date('2026-02-01T00:00:00.000Z'),
          ventaId: 'venta-1',
          stockResultante: 9,
        };
      },
      listByProducto: async () => ({ rows: [], total: 0 }),
      resumenRotacion: async () => ({ unidadesSalida30d: 0, diasHistoria: 0 }),
      listByPeriodo: async () => ({ rows: [], total: 0 }),
      listRecientes: async () => [],
    } as MovimientosRepo,
    ventas: {
      create: async (input: NuevaVenta) => {
        spies.ventasCreateCalls.push([input]);
        return makeVenta({ usuarioId: input.usuarioId, total: input.total });
      },
      createItems: async (items: NuevoItemVenta[]) =>
        items.map((item) => makeItemVenta({ ...item })),
      createPagos: async (pagos: NuevoPago[]) =>
        pagos.map((pago) => makePago({ ...pago, vuelto: pago.vuelto ?? '0' })),
      findById: async () => makeVenta(),
      findByNumeroCorrelativo: async () => makeVenta(),
      findItems: async () => [makeItemVenta()],
      findPagos: async () => [makePago()],
      marcarAnulada: async (input) => {
        spies.marcarAnuladaCalls.push([input]);
        return makeVenta({
          anuladaPor: input.anuladaPor,
          anuladaEn: new Date('2026-02-02T00:00:00.000Z'),
          motivoAnulacion: input.motivoAnulacion,
          estado: 'anulada',
        });
      },
      revertirPagos: async (ventaId: string) => {
        spies.revertirPagosCalls.push([ventaId]);
        return [makePago({ estado: 'revertido' })];
      },
      ...ventasOverrides,
    } as VentasRepo,
  };
}

function fakeUow(repos: ReturnType<typeof fakeRepos>): UnitOfWork {
  return {
    async run(work) {
      return work(repos as never, {
        savepoint: async (_name, fn) => fn(),
      });
    },
  };
}

async function buildTestApp(opts: {
  repos: ReturnType<typeof fakeRepos>;
  uow: UnitOfWork;
}): Promise<FastifyInstance> {
  const app = await buildApp({
    repos: opts.repos as unknown as Repos,
    uow: opts.uow,
    cookieSecret: COOKIE_SECRET,
    rateLimitMax: 10,
  });
  await app.ready();
  return app;
}

async function buildWithSession(
  sesion: Usuario | undefined,
  spies: Spies,
  productosOverrides: Partial<ProductosRepo> = {},
  ventasOverrides: Partial<VentasRepo> = {},
  usuariosOverrides: Partial<UsuariosRepo> = {},
) {
  const repos = fakeRepos(
    spies,
    productosOverrides,
    ventasOverrides,
    { findValid: async () => sesion },
    usuariosOverrides,
  );
  const app = await buildTestApp({ repos, uow: fakeUow(repos) });
  return app;
}

function emptySpies(): Spies {
  return {
    aplicarDeltaCalls: [],
    movimientosCreateCalls: [],
    ventasCreateCalls: [],
    productosListCalls: [],
    revertirStockPorAnulacionCalls: [],
    marcarAnuladaCalls: [],
    revertirPagosCalls: [],
  };
}

const routes = {
  confirmar: () => '/api/ventas',
  catalogo: () => '/api/ventas/catalogo',
  detalle: (id: string) => `/api/ventas/${id}`,
  porNumero: (numero: number | string) => `/api/ventas/numero/${numero}`,
  anular: (id: string) => `/api/ventas/${id}/anular`,
};

const validPayload = {
  items: [
    {
      productoId: PRODUCT_ID,
      cantidad: 1,
      precioUnitarioEsperado: '10.00',
    },
  ],
  pagos: [{ medio: 'efectivo', monto: '10.00' }],
};

describe('Role Gate — 401 unauthenticated on both routes', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 401 UNAUTHORIZED without a session on POST /ventas and GET /ventas/catalogo', async () => {
    app = await buildWithSession(undefined, emptySpies());

    for (const [method, url, payload] of [
      ['POST', routes.confirmar(), validPayload],
      ['GET', routes.catalogo(), undefined],
    ] as const) {
      const response = await app.inject({ method, url, payload });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    }
  });
});

describe('Role Gate — both encargado and deposito can confirm a sale and read the catalog', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('deposito gets 201 on POST /ventas', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: validPayload,
      cookies,
    });

    expect(response.statusCode).toBe(201);
  });

  it('encargado gets 201 on POST /ventas', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: validPayload,
      cookies,
    });

    expect(response.statusCode).toBe(201);
  });

  it('deposito gets 200 on GET /ventas/catalogo', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'GET',
      url: routes.catalogo(),
      cookies,
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('POST /api/ventas — 201 body shape', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns { venta, items, pagos } with the full row shape', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: validPayload,
      cookies,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.venta).toMatchObject({
      numeroCorrelativo: 1,
      estado: 'confirmada',
      total: '10.00',
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      productoId: PRODUCT_ID,
      cantidad: 1,
      precioUnitario: '10.00',
      subtotal: '10.00',
    });
    expect(body.pagos).toHaveLength(1);
    expect(body.pagos[0]).toMatchObject({
      medio: 'efectivo',
      monto: '10.00',
      vuelto: '0.00',
      estado: 'registrado',
    });
  });
});

describe('.strict() body — POST /api/ventas', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('rejects an unknown top-level key with 400 VALIDATION_ERROR, never opening a transaction', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: { ...validPayload, descuento: '5.00' },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(spies.ventasCreateCalls).toHaveLength(0);
  });

  it('rejects an unknown key inside an item as an unknown key', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: {
        items: [{ ...validPayload.items[0], nombre: 'Tornillo' }],
        pagos: validPayload.pagos,
      },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown medio value as 400 VALIDATION_ERROR (no new factory, RECONCILE-1)', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: {
        items: validPayload.items,
        pagos: [{ medio: 'cheque', monto: '10.00' }],
      },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty items array with 400 VALIDATION_ERROR', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: { items: [], pagos: validPayload.pagos },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty pagos array with 400 VALIDATION_ERROR', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: { items: validPayload.items, pagos: [] },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  // SECURITY-REPORT.md S06: items/pagos had no upper bound — confirmarVenta
  // walks the array twice inside one UnitOfWork transaction, so an unbounded
  // request could hold a pooled connection for thousands of sequential
  // round trips. 50 is the chosen cap (routes/ventas.ts).
  it('rejects an items array over the 50-item cap with 400 VALIDATION_ERROR, never opening a transaction', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };
    const items = Array.from({ length: 51 }, () => validPayload.items[0]);

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: { items, pagos: validPayload.pagos },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(spies.ventasCreateCalls).toHaveLength(0);
  });

  it('accepts an items array at exactly the 50-item cap', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };
    // confirmarVenta refuses a duplicate productoId (D13) before this even
    // opens a transaction, so the cap test needs 50 DISTINCT valid UUIDs —
    // the fake productos.findById ignores which id it was asked for and
    // always answers makeProducto() (price '10.00'), so pagos must total
    // 50 * 10.00 to clear the payment-total check too.
    const items = Array.from({ length: 50 }, (_, i) => ({
      ...validPayload.items[0],
      productoId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    }));

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: { items, pagos: [{ medio: 'efectivo', monto: '500.00' }] },
      cookies,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().items).toHaveLength(50);
  });

  it('rejects a pagos array over the 50-item cap with 400 VALIDATION_ERROR, never opening a transaction', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };
    const pagos = Array.from({ length: 51 }, () => validPayload.pagos[0]);

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: { items: validPayload.items, pagos },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(spies.ventasCreateCalls).toHaveLength(0);
  });
});

describe('Domain error mapping — POST /api/ventas', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('maps a price mismatch to 409 PRICE_CHANGED with the mismatch details', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies, {
      findById: async () => makeProducto({ precio: '12.00' }),
    });
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: validPayload,
      cookies,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('PRICE_CHANGED');
    expect(response.json().error.details.items).toHaveLength(1);
  });

  it('maps a duplicate producto_id in the request to 400 DUPLICATE_SALE_ITEM', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: {
        items: [validPayload.items[0], validPayload.items[0]],
        pagos: validPayload.pagos,
      },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('DUPLICATE_SALE_ITEM');
  });

  it('maps insufficient stock (aplicarDelta refusal) to 409 INSUFFICIENT_STOCK', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies, {
      aplicarDelta: async () => undefined,
    });
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.confirmar(),
      payload: validPayload,
      cookies,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INSUFFICIENT_STOCK');
  });
});

describe('GET /api/ventas/catalogo — D11 soloActivos forwarding', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('forwards { soloActivos: true } to ProductosRepo.list and returns the paginated envelope', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies, {
      list: async (...args: unknown[]) => {
        spies.productosListCalls.push(args);
        return { rows: [makeProducto()], total: 1 };
      },
    });
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'GET',
      url: `${routes.catalogo()}?page=1&pageSize=20`,
      cookies,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(body.data).toHaveLength(1);

    expect(spies.productosListCalls).toHaveLength(1);
    const [page, pageSize, q, opts] = spies.productosListCalls[0] as [
      number,
      number,
      string | undefined,
      { soloActivos?: boolean } | undefined,
    ];
    expect(page).toBe(1);
    expect(pageSize).toBe(20);
    expect(q).toBeUndefined();
    expect(opts).toEqual({ soloActivos: true });
  });
});

// recibo-interno (backlog #8) — tasks.md Task 1.4, design.md D1. This is
// the RED test that resolves design.md's flagged "assumption to verify at
// apply time, not asserted here": `GET /api/ventas/catalogo` must still
// reach the catalog handler once `GET /ventas/:id` is registered in the
// same plugin, never falling into the `:id` handler with `id="catalogo"`.
describe('Route-shadowing — GET /api/ventas/catalogo is not captured by GET /ventas/:id (design.md D1)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('still resolves to the catalog handler, not the detail handler with id="catalogo"', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'GET',
      url: routes.catalogo(),
      cookies,
    });

    // If Fastify had routed this to `GET /ventas/:id` instead, the params
    // schema (`id: z.string().uuid()`) would reject the literal string
    // "catalogo" with a 400 VALIDATION_ERROR, not the paginated envelope
    // `GET /ventas/catalogo` actually returns — so a 400 here would fail
    // for the wrong reason (proving shadowing), and this assertion on the
    // real 200 envelope shape proves it passes for the right one.
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).not.toHaveProperty('venta');
  });
});

describe('GET /api/ventas/:id and GET /api/ventas/numero/:numeroCorrelativo — role gate', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 401 UNAUTHORIZED without a session on both routes', async () => {
    app = await buildWithSession(undefined, emptySpies());

    for (const url of [routes.detalle(VALID_VENTA_UUID), routes.porNumero(1)]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    }
  });

  it.each(['encargado', 'deposito'] as const)(
    '%s gets 200 on both routes (PD-4 audit-style, not own-sale-only)',
    async (rol) => {
      const spies = emptySpies();
      app = await buildWithSession(makeUsuario({ rol }), spies);
      const cookies = { sid: app.signCookie('valid-token') };

      const detalle = await app.inject({
        method: 'GET',
        url: routes.detalle(VALID_VENTA_UUID),
        cookies,
      });
      expect(detalle.statusCode).toBe(200);

      const porNumero = await app.inject({
        method: 'GET',
        url: routes.porNumero(1),
        cookies,
      });
      expect(porNumero.statusCode).toBe(200);
    },
  );
});

describe('GET /api/ventas/:id — 200 body shape (design.md D7, okRecibo)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns { venta, cajero, items, pagos } with the item name composed from ProductosRepo', async () => {
    const spies = emptySpies();
    app = await buildWithSession(
      makeUsuario({ rol: 'encargado' }),
      spies,
      { findById: async () => makeProducto({ nombre: 'Nombre Actual' }) },
      {},
      { findById: async () => makeUsuarioResumen({ nombre: 'Cajera Uno' }) },
    );
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'GET',
      url: routes.detalle(VALID_VENTA_UUID),
      cookies,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.venta).toMatchObject({
      numeroCorrelativo: 1,
      estado: 'confirmada',
    });
    expect(body.cajero).toMatchObject({ nombre: 'Cajera Uno' });
    expect(body.items[0]).toMatchObject({ nombre: 'Nombre Actual' });
    expect(body.pagos).toHaveLength(1);
    // spec.md "Detail Read Path Excludes Store Configuration Data": no
    // store name/address field anywhere in the response.
    expect(JSON.stringify(body)).not.toMatch(/tienda|store/i);
  });
});

describe('GET /api/ventas/:id and .../numero/:n — 404 SALE_NOT_FOUND', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 404 SALE_NOT_FOUND for a nonexistent id', async () => {
    const spies = emptySpies();
    app = await buildWithSession(
      makeUsuario({ rol: 'encargado' }),
      spies,
      {},
      {
        findById: async () => undefined,
      },
    );
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'GET',
      url: routes.detalle('00000000-0000-4000-8000-000000000000'),
      cookies,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SALE_NOT_FOUND');
  });

  it('returns 404 SALE_NOT_FOUND for a nonexistent numeroCorrelativo', async () => {
    const spies = emptySpies();
    app = await buildWithSession(
      makeUsuario({ rol: 'encargado' }),
      spies,
      {},
      {
        findByNumeroCorrelativo: async () => undefined,
      },
    );
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'GET',
      url: routes.porNumero(999),
      cookies,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SALE_NOT_FOUND');
  });
});

describe('GET /api/ventas/:id and .../numero/:n — param validation', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('rejects a non-uuid :id with 400 VALIDATION_ERROR', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'GET',
      url: routes.detalle('not-a-uuid'),
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-integer :numeroCorrelativo with 400 VALIDATION_ERROR', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'GET',
      url: routes.porNumero('abc'),
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

// backlog #9 (anulacion-venta) tasks.md 4.1, design.md's "action-style,
// first encargado-only route in this file".
describe('POST /api/ventas/:id/anular — role gate', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 401 UNAUTHORIZED without a session', async () => {
    app = await buildWithSession(undefined, emptySpies());

    const response = await app.inject({
      method: 'POST',
      url: routes.anular(VALID_VENTA_UUID),
      payload: { motivoAnulacion: 'Cliente canceló el pedido' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 FORBIDDEN for rol = deposito, and writes nothing', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.anular(VALID_VENTA_UUID),
      payload: { motivoAnulacion: 'Cliente canceló el pedido' },
      cookies,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
    // Assert the DB (via the repo spies), not just the status code
    // (CLAUDE.md's rule): a 403 must write nothing.
    expect(spies.marcarAnuladaCalls).toHaveLength(0);
    expect(spies.revertirStockPorAnulacionCalls).toHaveLength(0);
    expect(spies.revertirPagosCalls).toHaveLength(0);
  });

  it('returns 200 for rol = encargado with a valid body', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.anular(VALID_VENTA_UUID),
      payload: { motivoAnulacion: 'Cliente canceló el pedido' },
      cookies,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.venta).toMatchObject({ estado: 'anulada' });
    expect(spies.marcarAnuladaCalls).toHaveLength(1);
  });
});

describe('POST /api/ventas/:id/anular — motivoAnulacion validation (3-500 after trim)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace-only', '   '],
    ['too short (2 chars)', 'ab'],
    ['too long (501 chars)', 'a'.repeat(501)],
  ])(
    'rejects %s motivoAnulacion with 400 VALIDATION_ERROR',
    async (_label, motivoAnulacion) => {
      const spies = emptySpies();
      app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
      const cookies = { sid: app.signCookie('valid-token') };

      const payload = motivoAnulacion === undefined ? {} : { motivoAnulacion };

      const response = await app.inject({
        method: 'POST',
        url: routes.anular(VALID_VENTA_UUID),
        payload,
        cookies,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
      expect(spies.marcarAnuladaCalls).toHaveLength(0);
    },
  );

  it('accepts a motivo at exactly 3 and exactly 500 characters', async () => {
    for (const motivoAnulacion of ['abc', 'a'.repeat(500)]) {
      const spies = emptySpies();
      const localApp = await buildWithSession(
        makeUsuario({ rol: 'encargado' }),
        spies,
      );
      const cookies = { sid: localApp.signCookie('valid-token') };

      const response = await localApp.inject({
        method: 'POST',
        url: routes.anular(VALID_VENTA_UUID),
        payload: { motivoAnulacion },
        cookies,
      });

      expect(response.statusCode).toBe(200);
      await localApp.close();
    }
  });
});

describe('POST /api/ventas/:id/anular — domain error mapping', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 404 SALE_NOT_FOUND when marcarAnulada is refused and findById is absent', async () => {
    const spies = emptySpies();
    app = await buildWithSession(
      makeUsuario({ rol: 'encargado' }),
      spies,
      {},
      {
        marcarAnulada: async (input) => {
          spies.marcarAnuladaCalls.push([input]);
          return undefined;
        },
        findById: async () => undefined,
      },
    );
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.anular(VALID_VENTA_UUID),
      payload: { motivoAnulacion: 'Cliente canceló el pedido' },
      cookies,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SALE_NOT_FOUND');
  });

  it('returns 409 SALE_ALREADY_VOIDED when marcarAnulada is refused and the venta already exists, writing nothing further', async () => {
    const spies = emptySpies();
    app = await buildWithSession(
      makeUsuario({ rol: 'encargado' }),
      spies,
      {},
      {
        marcarAnulada: async (input) => {
          spies.marcarAnuladaCalls.push([input]);
          return undefined;
        },
        findById: async () => makeVenta({ estado: 'anulada' }),
      },
    );
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.anular(VALID_VENTA_UUID),
      payload: { motivoAnulacion: 'Cliente canceló el pedido' },
      cookies,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SALE_ALREADY_VOIDED');
    expect(spies.revertirStockPorAnulacionCalls).toHaveLength(0);
    expect(spies.revertirPagosCalls).toHaveLength(0);
  });

  it('rejects a non-uuid :id with 400 VALIDATION_ERROR', async () => {
    const spies = emptySpies();
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.anular('not-a-uuid'),
      payload: { motivoAnulacion: 'Cliente canceló el pedido' },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});
