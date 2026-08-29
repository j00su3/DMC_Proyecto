import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { UnitOfWork } from '../db/uow.js';
import type { MovimientosRepo } from '../movimientos/repository.js';
import type { Repos } from '../plugins/repos.js';
import type { Producto, ProductosRepo } from '../productos/repository.js';
import type { Proveedor, ProveedoresRepo } from '../proveedores/repository.js';
import type { Usuario, UsuariosRepo } from '../usuarios/repository.js';

// `productosRoutes` is registered in `app.ts` as of task 7.2 (Phase 7,
// S4b), so this file builds its app through the REAL `buildApp` — the same
// plugin registration order (including `authPlugin` before every route
// plugin) production actually runs — instead of a local copy of it. A copy
// cannot detect a divergence from the thing it copies (see app.ts's own
// registration-order note); using `buildApp` directly removes that risk.
async function buildTestApp(opts: {
  repos: ReturnType<typeof fakeRepos>;
  uow: UnitOfWork;
  cookieSecret: string;
}): Promise<FastifyInstance> {
  const app = await buildApp({
    repos: opts.repos as unknown as Repos,
    uow: opts.uow,
    cookieSecret: opts.cookieSecret,
    rateLimitMax: 10,
  });
  await app.ready();
  return app;
}

const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PROVEEDOR_ID = '22222222-2222-4222-8222-222222222222';

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

function makeProveedor(overrides: Partial<Proveedor> = {}): Proveedor {
  return {
    id: PROVEEDOR_ID,
    nombre: 'Distribuidora Norte',
    contacto: null,
    activo: true,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeProducto(overrides: Partial<Producto> = {}): Producto {
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
    ...overrides,
  };
}

function fakeRepos(
  productos: Partial<ProductosRepo> = {},
  proveedores: Partial<ProveedoresRepo> = {},
  sesiones: Partial<SesionesRepo> = {},
) {
  return {
    usuarios: {} as UsuariosRepo,
    sesiones: {
      create: async () => {},
      findValid: async () => undefined,
      delete: async () => {},
      purgeExpired: async () => {},
      deleteOthers: async () => {},
      deleteAllForUser: async () => {},
      ...sesiones,
    } as SesionesRepo,
    auditoria: { record: async () => {} } as AuditoriaRepo,
    proveedores: {
      list: async () => ({ rows: [], total: 0 }),
      findById: async () => makeProveedor(),
      findByIdForUpdate: async () => makeProveedor(),
      create: async () => makeProveedor(),
      update: async () => makeProveedor(),
      setActivo: async () => makeProveedor(),
      ...proveedores,
    } as ProveedoresRepo,
    productos: {
      list: async () => ({ rows: [makeProducto()], total: 1 }),
      findById: async () => makeProducto(),
      findByIdForUpdate: async () => makeProducto(),
      create: async () => makeProducto(),
      update: async () => makeProducto(),
      setActivo: async () => makeProducto(),
      aplicarDelta: async () => 0,
      ...productos,
    } as ProductosRepo,
    movimientos: { create: async () => ({}) } as unknown as MovimientosRepo,
  };
}

function fakeUow(repos: ReturnType<typeof fakeRepos>): UnitOfWork {
  return {
    async run(work) {
      return work(repos as never);
    },
  };
}

async function buildWithSession(
  sesion: Usuario | undefined,
  productos: Partial<ProductosRepo> = {},
  proveedores: Partial<ProveedoresRepo> = {},
) {
  const repos = fakeRepos(productos, proveedores, {
    findValid: async () => sesion,
  });
  const app = await buildTestApp({
    repos,
    uow: fakeUow(repos),
    cookieSecret: COOKIE_SECRET,
  });
  return app;
}

const routes = {
  list: () => '/api/productos',
  get: () => `/api/productos/${PRODUCT_ID}`,
  create: () => '/api/productos',
  update: () => `/api/productos/${PRODUCT_ID}`,
};

function crearBody(overrides: Record<string, unknown> = {}) {
  return {
    nombre: 'Tornillo Phillips',
    sku: 'TP-001',
    precio: '10.00',
    proveedorId: PROVEEDOR_ID,
    ...overrides,
  };
}

describe('Role Gate — GET/POST/PATCH open to both roles', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  // tasks.md task 6.1 says "all five routes this slice adds"; this slice
  // (S4a) ships exactly four (GET list, GET :id, POST, PATCH) — the
  // deactivate/reactivate pair is S4b (Phase 7). Treated as a stale count in
  // tasks.md, same class of inaccuracy as its own flagged "task 6.4"
  // reference; tested against the four routes this slice actually adds.
  it('returns 401 UNAUTHORIZED without a session on all four routes', async () => {
    app = await buildWithSession(undefined);

    for (const [method, url, payload] of [
      ['GET', routes.list(), undefined],
      ['GET', routes.get(), undefined],
      ['POST', routes.create(), crearBody()],
      ['PATCH', routes.update(), { nombre: 'x' }],
    ] as const) {
      const response = await app.inject({ method, url, payload });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    }
  });

  it('returns 200/201 for a deposito session on both GETs and on POST without stockMinimo', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));
    const cookies = { sid: app.signCookie('valid-token') };

    const listResponse = await app.inject({
      method: 'GET',
      url: routes.list(),
      cookies,
    });
    expect(listResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: 'GET',
      url: routes.get(),
      cookies,
    });
    expect(getResponse.statusCode).toBe(200);

    const postResponse = await app.inject({
      method: 'POST',
      url: routes.create(),
      payload: crearBody(),
      cookies,
    });
    expect(postResponse.statusCode).toBe(201);
  });

  it('returns 403 FIELD_RESERVED_FOR_ENCARGADO for a deposito session sending stockMinimo on POST/PATCH (any value)', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));
    const cookies = { sid: app.signCookie('valid-token') };

    const postResponse = await app.inject({
      method: 'POST',
      url: routes.create(),
      payload: crearBody({ stockMinimo: null }),
      cookies,
    });
    expect(postResponse.statusCode).toBe(403);
    expect(postResponse.json().error.code).toBe('FIELD_RESERVED_FOR_ENCARGADO');

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: routes.update(),
      payload: { stockMinimo: 5 },
      cookies,
    });
    expect(patchResponse.statusCode).toBe(403);
    expect(patchResponse.json().error.code).toBe(
      'FIELD_RESERVED_FOR_ENCARGADO',
    );
  });

  it('an encargado sets stockMinimo freely on POST (201), PATCH (200), and reads it back (200)', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), {
      create: async () => makeProducto({ stockMinimo: 5 }),
      update: async () => makeProducto({ stockMinimo: 5 }),
    });
    const cookies = { sid: app.signCookie('valid-token') };

    const postResponse = await app.inject({
      method: 'POST',
      url: routes.create(),
      payload: crearBody({ stockMinimo: 5 }),
      cookies,
    });
    expect(postResponse.statusCode).toBe(201);

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: routes.update(),
      payload: { stockMinimo: 5 },
      cookies,
    });
    expect(patchResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: 'GET',
      url: routes.get(),
      cookies,
    });
    expect(getResponse.statusCode).toBe(200);
  });
});

describe('PATCH /api/productos/:id — .strict() rejects stockActual before any handler runs', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  // Satisfies spec.md's "Stock Correction After Creation Requires A
  // Movement, Not This Endpoint": actualizarProductoBody has no
  // `stockActual` key in its shape at all, same `.strict()` technique as
  // `actualizarProveedorBody` (routes/proveedores.ts:52-60) — a handler-level
  // check would run AFTER the request already reached the service, which is
  // exactly what this proves does not happen (`handlerReached` stays false).
  it('rejects a stockActual key with 400 VALIDATION_ERROR before the handler runs', async () => {
    let handlerReached = false;
    app = await buildWithSession(makeUsuario(), {
      findByIdForUpdate: async () => {
        handlerReached = true;
        return makeProducto();
      },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: routes.update(),
      payload: { stockActual: 999 },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(handlerReached).toBe(false);
  });

  // The spec writes the key as `stock_actual` (`spec.md:101-104`), the column
  // spelling, while this API is camelCase over the wire like every other route
  // (`creadoEn`, `debeCambiarPassword`). `.strict()` refuses both spellings
  // because neither is in the shape, but only the camelCase one was proven.
  // The spec names this one, so it gets its own assertion rather than relying
  // on the reader to infer that the other case is covered.
  it("rejects the spec's snake_case stock_actual key the same way", async () => {
    let handlerReached = false;
    app = await buildWithSession(makeUsuario(), {
      findByIdForUpdate: async () => {
        handlerReached = true;
        return makeProducto();
      },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: routes.update(),
      payload: { stock_actual: 999 },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(handlerReached).toBe(false);
  });
});

describe('POST /api/productos', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 400 VALIDATION_ERROR when proveedorId is missing', async () => {
    app = await buildWithSession(makeUsuario());

    const { proveedorId: _omit, ...withoutProveedorId } = crearBody();
    const response = await app.inject({
      method: 'POST',
      url: routes.create(),
      payload: withoutProveedorId,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('maps a duplicate sku to 409 SKU_ALREADY_IN_USE', async () => {
    const { skuAlreadyInUse } = await import('../lib/errors.js');
    app = await buildWithSession(makeUsuario(), {
      create: async () => {
        throw skuAlreadyInUse();
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: routes.create(),
      payload: crearBody(),
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SKU_ALREADY_IN_USE');
  });

  it('maps an inactive proveedorId to 409 SUPPLIER_INACTIVE', async () => {
    app = await buildWithSession(makeUsuario(), undefined, {
      findById: async () => makeProveedor({ activo: false }),
    });

    const response = await app.inject({
      method: 'POST',
      url: routes.create(),
      payload: crearBody(),
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SUPPLIER_INACTIVE');
  });
});

describe('PATCH /api/productos/:id — SKU/supplier conflicts', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('maps a duplicate sku to 409 SKU_ALREADY_IN_USE', async () => {
    const { skuAlreadyInUse } = await import('../lib/errors.js');
    app = await buildWithSession(makeUsuario(), {
      update: async () => {
        throw skuAlreadyInUse();
      },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: routes.update(),
      payload: { sku: 'OTRO-1' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SKU_ALREADY_IN_USE');
  });

  it('maps an inactive proveedorId to 409 SUPPLIER_INACTIVE', async () => {
    app = await buildWithSession(makeUsuario(), undefined, {
      findById: async () => makeProveedor({ activo: false }),
    });

    const response = await app.inject({
      method: 'PATCH',
      url: routes.update(),
      payload: { proveedorId: PROVEEDOR_ID },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SUPPLIER_INACTIVE');
  });
});

describe('GET /api/productos', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('?q=... reaches the service', async () => {
    let receivedQ: string | undefined;
    app = await buildWithSession(makeUsuario(), {
      list: async (_page, _pageSize, q) => {
        receivedQ = q;
        return { rows: [makeProducto()], total: 1 };
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/productos?q=torn',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(receivedQ).toBe('torn');
  });

  it('?page&pageSize responds with the { data, page, pageSize, total } envelope', async () => {
    app = await buildWithSession(makeUsuario(), {
      list: async () => ({ rows: [makeProducto()], total: 1 }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/productos?page=1&pageSize=20',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(response.json().data).toHaveLength(1);
  });
});

describe('POST /api/productos/:id/{deactivate,reactivate} — encargado-only (Phase 7, S4b)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const routesLifecycle = {
    deactivate: () => `/api/productos/${PRODUCT_ID}/deactivate`,
    reactivate: () => `/api/productos/${PRODUCT_ID}/reactivate`,
  };

  it('returns 403 FORBIDDEN (plain code) for a deposito session on both routes', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));
    const cookies = { sid: app.signCookie('valid-token') };

    for (const url of [
      routesLifecycle.deactivate(),
      routesLifecycle.reactivate(),
    ]) {
      const response = await app.inject({ method: 'POST', url, cookies });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    }
  });

  it('returns 200 for an encargado session on both routes', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), {
      setActivo: async (_id, activo) => makeProducto({ activo }),
    });
    const cookies = { sid: app.signCookie('valid-token') };

    const deactivateResponse = await app.inject({
      method: 'POST',
      url: routesLifecycle.deactivate(),
      cookies,
    });
    expect(deactivateResponse.statusCode).toBe(200);

    const reactivateResponse = await app.inject({
      method: 'POST',
      url: routesLifecycle.reactivate(),
      cookies,
    });
    expect(reactivateResponse.statusCode).toBe(200);
  });

  it('a deactivated product still returns 200 (not 404) from GET /api/productos/:id, with activo: false', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), {
      findById: async () => makeProducto({ activo: false }),
    });
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'GET',
      url: routes.get(),
      cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().producto.activo).toBe(false);
  });
});
