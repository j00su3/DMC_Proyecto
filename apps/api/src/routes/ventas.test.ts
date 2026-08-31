import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { UnitOfWork } from '../db/uow.js';
import type { MovimientosRepo } from '../movimientos/repository.js';
import type { Repos } from '../plugins/repos.js';
import type { Producto, ProductosRepo } from '../productos/repository.js';
import type { Usuario } from '../usuarios/repository.js';
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

interface Spies {
  aplicarDeltaCalls: unknown[][];
  movimientosCreateCalls: unknown[][];
  ventasCreateCalls: unknown[][];
  productosListCalls: unknown[][];
}

function fakeRepos(
  spies: Spies,
  productosOverrides: Partial<ProductosRepo> = {},
  ventasOverrides: Partial<VentasRepo> = {},
  sesionesOverrides: Partial<SesionesRepo> = {},
) {
  return {
    usuarios: {} as never,
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
      ...ventasOverrides,
    } as VentasRepo,
  };
}

function fakeUow(repos: ReturnType<typeof fakeRepos>): UnitOfWork {
  return {
    async run(work) {
      return work(repos as never);
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
) {
  const repos = fakeRepos(spies, productosOverrides, ventasOverrides, {
    findValid: async () => sesion,
  });
  const app = await buildTestApp({ repos, uow: fakeUow(repos) });
  return app;
}

function emptySpies(): Spies {
  return {
    aplicarDeltaCalls: [],
    movimientosCreateCalls: [],
    ventasCreateCalls: [],
    productosListCalls: [],
  };
}

const routes = {
  confirmar: () => '/api/ventas',
  catalogo: () => '/api/ventas/catalogo',
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
