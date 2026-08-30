import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { UnitOfWork } from '../db/uow.js';
import type { Movimiento, MovimientosRepo } from '../movimientos/repository.js';
import type { Repos } from '../plugins/repos.js';
import type { Producto, ProductosRepo } from '../productos/repository.js';
import type { Usuario } from '../usuarios/repository.js';

// routes/movimientos.ts (task 4.2) does not exist yet at RED time — this file
// exercises it through the REAL `buildApp`, same technique as
// routes/productos.test.ts, so a divergence in registration order/config
// cannot hide behind a local copy of the plugin wiring.

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

function makeMovimiento(overrides: Partial<Movimiento> = {}): Movimiento {
  return {
    id: 'mov-1',
    productoId: PRODUCT_ID,
    tipo: 'entrada',
    cantidad: 5,
    motivo: null,
    esDiscrepancia: false,
    esMerma: false,
    usuarioId: 'u1',
    fecha: new Date('2026-02-01T00:00:00.000Z'),
    ventaId: null,
    stockResultante: 15,
    ...overrides,
  };
}

interface Spies {
  aplicarDeltaCalls: unknown[][];
  movimientosCreateCalls: unknown[][];
}

function fakeRepos(
  spies: Spies,
  productosOverrides: Partial<ProductosRepo> = {},
  movimientosOverrides: Partial<MovimientosRepo> = {},
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
      list: async () => ({ rows: [], total: 0 }),
      findById: async () => makeProducto(),
      findByIdForUpdate: async () => makeProducto(),
      create: async () => makeProducto(),
      update: async () => makeProducto(),
      setActivo: async () => makeProducto(),
      aplicarDelta: async (...args: unknown[]) => {
        spies.aplicarDeltaCalls.push(args);
        return 15;
      },
      ...productosOverrides,
    } as ProductosRepo,
    movimientos: {
      create: async (...args: unknown[]) => {
        spies.movimientosCreateCalls.push(args);
        return makeMovimiento();
      },
      listByProducto: async () => ({ rows: [makeMovimiento()], total: 1 }),
      ...movimientosOverrides,
    } as MovimientosRepo,
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
  movimientosOverrides: Partial<MovimientosRepo> = {},
) {
  const repos = fakeRepos(spies, productosOverrides, movimientosOverrides, {
    findValid: async () => sesion,
  });
  const app = await buildTestApp({ repos, uow: fakeUow(repos) });
  return app;
}

const routes = {
  history: () => `/api/productos/${PRODUCT_ID}/movimientos`,
  entrada: () => `/api/productos/${PRODUCT_ID}/movimientos/entrada`,
  salida: () => `/api/productos/${PRODUCT_ID}/movimientos/salida`,
  ajuste: () => `/api/productos/${PRODUCT_ID}/movimientos/ajuste`,
};

describe('Role Gate — 401 unauthenticated on all four routes', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 401 UNAUTHORIZED without a session on GET history and all three POST routes', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(undefined, spies);

    for (const [method, url, payload] of [
      ['GET', routes.history(), undefined],
      ['POST', routes.entrada(), { cantidad: 5 }],
      ['POST', routes.salida(), { cantidad: 5, esMerma: false }],
      [
        'POST',
        routes.ajuste(),
        { cantidad: 5, direccion: 'sumar', esDiscrepancia: false, motivo: 'conteo' },
      ],
    ] as const) {
      const response = await app.inject({ method, url, payload });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    }
  });
});

describe('Role Gate — entrada/salida open to both roles, ajuste encargado-only', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('deposito gets 201 on entrada and salida', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const entradaResponse = await app.inject({
      method: 'POST',
      url: routes.entrada(),
      payload: { cantidad: 5 },
      cookies,
    });
    expect(entradaResponse.statusCode).toBe(201);

    const salidaResponse = await app.inject({
      method: 'POST',
      url: routes.salida(),
      payload: { cantidad: 5, esMerma: false },
      cookies,
    });
    expect(salidaResponse.statusCode).toBe(201);
  });

  // D5: the config.roles preHandler is where PD-1's boundary actually lives.
  // apps/api/src/plugins/auth.ts:92-95 throws a plain `forbidden()` (code
  // FORBIDDEN) for a config.roles refusal — the same mechanism already
  // proven by routes/productos.test.ts's deactivate/reactivate suite. The
  // spec (specs/inventory-movements/spec.md:23) names
  // ADJUSTMENT_RESERVED_FOR_ENCARGADO for this refusal; the actual mechanism
  // this route table uses produces plain FORBIDDEN instead. Asserting the
  // real mechanism here, per the orchestrator's explicit instruction, and
  // reporting the discrepancy rather than inventing a service-level branch
  // to manufacture a different code.
  it('deposito gets 403 FORBIDDEN on ajuste, and neither stock nor the ledger is touched', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.ajuste(),
      payload: {
        cantidad: 5,
        direccion: 'sumar',
        esDiscrepancia: false,
        motivo: 'conteo',
      },
      cookies,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
    expect(spies.aplicarDeltaCalls).toHaveLength(0);
    expect(spies.movimientosCreateCalls).toHaveLength(0);
  });

  it('encargado gets 201 on entrada, salida, and ajuste', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const entradaResponse = await app.inject({
      method: 'POST',
      url: routes.entrada(),
      payload: { cantidad: 5 },
      cookies,
    });
    expect(entradaResponse.statusCode).toBe(201);

    const salidaResponse = await app.inject({
      method: 'POST',
      url: routes.salida(),
      payload: { cantidad: 5, esMerma: true, motivo: 'robo' },
      cookies,
    });
    expect(salidaResponse.statusCode).toBe(201);

    const ajusteResponse = await app.inject({
      method: 'POST',
      url: routes.ajuste(),
      payload: {
        cantidad: 5,
        direccion: 'restar',
        esDiscrepancia: true,
        motivo: 'conteo',
      },
      cookies,
    });
    expect(ajusteResponse.statusCode).toBe(201);
    expect(spies.movimientosCreateCalls).toHaveLength(3);
  });
});

describe('D7 body shapes — .strict() enforces the literal columns', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('rejects esMerma on the entrada body as an unknown key (400 VALIDATION_ERROR), never calling the repo', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.entrada(),
      payload: { cantidad: 5, esMerma: true },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(spies.movimientosCreateCalls).toHaveLength(0);
  });

  it('rejects esDiscrepancia on the entrada body as an unknown key', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.entrada(),
      payload: { cantidad: 5, esDiscrepancia: true },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(spies.movimientosCreateCalls).toHaveLength(0);
  });

  it('rejects esDiscrepancia on the salida body as an unknown key', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.salida(),
      payload: { cantidad: 5, esMerma: false, esDiscrepancia: true },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(spies.movimientosCreateCalls).toHaveLength(0);
  });

  it('rejects esMerma on the ajuste body as an unknown key', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.ajuste(),
      payload: {
        cantidad: 5,
        direccion: 'sumar',
        esDiscrepancia: false,
        esMerma: true,
        motivo: 'conteo',
      },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(spies.movimientosCreateCalls).toHaveLength(0);
  });

  it('routes forward the D7 literal flags unchanged: entrada -> {esMerma:false, esDiscrepancia:false}', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    await app.inject({
      method: 'POST',
      url: routes.entrada(),
      payload: { cantidad: 5 },
      cookies,
    });

    const [input] = spies.movimientosCreateCalls[0] as [
      { esMerma: boolean; esDiscrepancia: boolean },
    ];
    expect(input.esMerma).toBe(false);
    expect(input.esDiscrepancia).toBe(false);
  });

  it('routes forward the D7 literal flags unchanged: salida -> {esDiscrepancia:false}, esMerma from body', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    await app.inject({
      method: 'POST',
      url: routes.salida(),
      payload: { cantidad: 5, esMerma: true, motivo: 'robo' },
      cookies,
    });

    const [input] = spies.movimientosCreateCalls[0] as [
      { esMerma: boolean; esDiscrepancia: boolean },
    ];
    expect(input.esMerma).toBe(true);
    expect(input.esDiscrepancia).toBe(false);
  });

  it('routes forward the D7 literal flags unchanged: ajuste -> {esMerma:false}, esDiscrepancia from body', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    await app.inject({
      method: 'POST',
      url: routes.ajuste(),
      payload: {
        cantidad: 5,
        direccion: 'sumar',
        esDiscrepancia: true,
        motivo: 'conteo',
      },
      cookies,
    });

    const [input] = spies.movimientosCreateCalls[0] as [
      { esMerma: boolean; esDiscrepancia: boolean },
    ];
    expect(input.esMerma).toBe(false);
    expect(input.esDiscrepancia).toBe(true);
  });
});

describe('cantidad is a positive magnitude, never zero, on the wire', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('rejects cantidad: 0 on entrada with 400 VALIDATION_ERROR', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.entrada(),
      payload: { cantidad: 0 },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(spies.movimientosCreateCalls).toHaveLength(0);
  });

  it('rejects cantidad: 0 on ajuste with 400 VALIDATION_ERROR — unrepresentable on the wire, per D7', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.ajuste(),
      payload: {
        cantidad: 0,
        direccion: 'sumar',
        esDiscrepancia: false,
        motivo: 'conteo',
      },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(spies.movimientosCreateCalls).toHaveLength(0);
  });

  it('rejects a negative cantidad the same way', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'POST',
      url: routes.entrada(),
      payload: { cantidad: -3 },
      cookies,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/productos/:id/movimientos — history, paginated, both roles', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns { data, page, pageSize, total } with the full row shape', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(
      makeUsuario({ rol: 'deposito' }),
      spies,
      {},
      {
        listByProducto: async () => ({
          rows: [
            makeMovimiento({
              tipo: 'salida',
              cantidad: -3,
              stockResultante: 7,
              motivo: 'rotura',
              esMerma: true,
            }),
          ],
          total: 1,
        }),
      },
    );
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'GET',
      url: `${routes.history()}?page=1&pageSize=20`,
      cookies,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      tipo: 'salida',
      cantidad: -3,
      stockResultante: 7,
      motivo: 'rotura',
      esMerma: true,
      usuarioId: 'u1',
    });
    expect(body.data[0].fecha).toBeDefined();
  });

  it('a deposito session can also read the history (both roles allowed)', async () => {
    const spies: Spies = { aplicarDeltaCalls: [], movimientosCreateCalls: [] };
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }), spies);
    const cookies = { sid: app.signCookie('valid-token') };

    const response = await app.inject({
      method: 'GET',
      url: routes.history(),
      cookies,
    });

    expect(response.statusCode).toBe(200);
  });
});
