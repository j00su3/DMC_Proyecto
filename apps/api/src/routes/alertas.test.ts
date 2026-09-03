import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Alerta, AlertasRepo } from '../alertas/repository.js';
import { buildApp } from '../app.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { UnitOfWork } from '../db/uow.js';
import type { MovimientosRepo } from '../movimientos/repository.js';
import type { Producto, ProductosRepo } from '../productos/repository.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
import type { Usuario, UsuariosRepo } from '../usuarios/repository.js';
import type { VentasRepo } from '../ventas/repository.js';

const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const ALERT_ID = '33333333-3333-4333-8333-333333333333';

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

function makeAlerta(overrides: Partial<Alerta> = {}): Alerta {
  return {
    id: ALERT_ID,
    productoId: 'producto-1',
    tipo: 'discrepancia',
    estado: 'activa',
    movimientoId: 'movimiento-1',
    creadaEn: new Date('2026-09-02T00:00:00.000Z'),
    resueltaEn: null,
    resueltaPor: null,
    ...overrides,
  };
}

function makeProducto(overrides: Partial<Producto> = {}): Producto {
  return {
    id: 'producto-1',
    nombre: 'Producto Uno',
    sku: 'SKU-1',
    categoria: null,
    stockActual: 5,
    stockMinimo: 10,
    precio: '100.00',
    proveedorId: 'proveedor-1',
    activo: true,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeRepos(
  alertas: Partial<AlertasRepo> = {},
  productos: Partial<ProductosRepo> = {},
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
    proveedores: {} as ProveedoresRepo,
    productos: {
      findById: async () => makeProducto(),
      ...productos,
    } as ProductosRepo,
    movimientos: {} as MovimientosRepo,
    ventas: {} as VentasRepo,
    alertas: {
      create: async () => makeAlerta(),
      autoResolve: async () => makeAlerta(),
      manualResolve: async () => makeAlerta({ estado: 'resuelta' }),
      marcarVistas: async () => 0,
      findById: async () => makeAlerta(),
      list: async () => ({ rows: [makeAlerta()], total: 1 }),
      countAbiertas: async () => 0,
      ...alertas,
    } as AlertasRepo,
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

async function buildWithSession(
  sesion: Usuario | undefined,
  alertas: Partial<AlertasRepo> = {},
  productos: Partial<ProductosRepo> = {},
) {
  const repos = fakeRepos(alertas, productos, {
    findValid: async () => sesion,
  });
  const app = await buildApp({
    repos,
    uow: fakeUow(repos),
    cookieSecret: COOKIE_SECRET,
  });
  await app.ready();
  return app;
}

const readRoutes = [
  { method: 'GET' as const, url: () => '/api/alertas' },
  { method: 'GET' as const, url: () => '/api/alertas/conteo' },
];

const bothRolesWriteRoutes = [
  { method: 'POST' as const, url: () => '/api/alertas/marcar-vistas' },
];

const encargadoOnlyRoutes = [
  { method: 'POST' as const, url: () => `/api/alertas/${ALERT_ID}/resolver` },
];

describe('Role Gate — alertas routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 200 for a deposito session on both read routes and marcar-vistas', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));
    const cookies = { sid: app.signCookie('valid-token') };

    for (const route of [...readRoutes, ...bothRolesWriteRoutes]) {
      const response = await app.inject({
        method: route.method,
        url: route.url(),
        cookies,
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it('returns 403 FORBIDDEN for a deposito session on the resolve route', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));
    const cookies = { sid: app.signCookie('valid-token') };

    for (const route of encargadoOnlyRoutes) {
      const response = await app.inject({
        method: route.method,
        url: route.url(),
        cookies,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    }
  });

  it('returns 401 UNAUTHORIZED without a session on every alertas route', async () => {
    app = await buildWithSession(undefined);

    for (const route of [
      ...readRoutes,
      ...bothRolesWriteRoutes,
      ...encargadoOnlyRoutes,
    ]) {
      const response = await app.inject({
        method: route.method,
        url: route.url(),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    }
  });
});

describe('GET /api/alertas', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns the paginated envelope with productoNombre resolved per row (D6)', async () => {
    app = await buildWithSession(
      makeUsuario(),
      { list: async () => ({ rows: [makeAlerta()], total: 1 }) },
      { findById: async () => makeProducto({ nombre: 'Producto Resuelto' }) },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/alertas',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(response.json().data[0].productoNombre).toBe('Producto Resuelto');
  });

  it('filters by estado when the query param is present', async () => {
    let capturedFiltro: unknown;
    app = await buildWithSession(makeUsuario(), {
      list: async (filtro) => {
        capturedFiltro = filtro;
        return { rows: [], total: 0 };
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/alertas?estado=activa',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(capturedFiltro).toEqual({ estado: 'activa' });
  });
});

describe('GET /api/alertas/conteo', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns { abiertas } from countAbiertas', async () => {
    app = await buildWithSession(makeUsuario(), {
      countAbiertas: async () => 7,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/alertas/conteo',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ abiertas: 7 });
  });
});

describe('POST /api/alertas/:id/resolver', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('resolves an activa discrepancia and returns it resuelta', async () => {
    app = await buildWithSession(makeUsuario(), {
      findById: async () =>
        makeAlerta({ tipo: 'discrepancia', estado: 'activa' }),
      manualResolve: async (id, resueltaPor) =>
        makeAlerta({ id, estado: 'resuelta', resueltaPor }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/alertas/${ALERT_ID}/resolver`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().alerta.estado).toBe('resuelta');
    expect(response.json().alerta.resueltaPor).toBe('u1');
  });

  it('returns 404 ALERT_NOT_FOUND for an id that matches no row', async () => {
    app = await buildWithSession(makeUsuario(), {
      findById: async () => undefined,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/alertas/${ALERT_ID}/resolver`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('ALERT_NOT_FOUND');
  });

  it('returns 409 ALERT_ALREADY_RESOLVED for an already-resuelta alert', async () => {
    app = await buildWithSession(makeUsuario(), {
      findById: async () => makeAlerta({ estado: 'resuelta' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/alertas/${ALERT_ID}/resolver`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ALERT_ALREADY_RESOLVED');
  });

  it('resolves an activa sugerencia_reposicion and returns it resuelta, without a 409 (design.md D2)', async () => {
    app = await buildWithSession(makeUsuario(), {
      findById: async () =>
        makeAlerta({ tipo: 'sugerencia_reposicion', estado: 'activa' }),
      manualResolve: async (id, resueltaPor) =>
        makeAlerta({
          id,
          tipo: 'sugerencia_reposicion',
          estado: 'resuelta',
          resueltaPor,
        }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/alertas/${ALERT_ID}/resolver`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().alerta.tipo).toBe('sugerencia_reposicion');
    expect(response.json().alerta.estado).toBe('resuelta');
    expect(response.json().alerta.resueltaPor).toBe('u1');
  });

  it('returns 403 FORBIDDEN for a deposito session resolving a sugerencia_reposicion alert, DB state unchanged', async () => {
    const manualResolve = vi.fn(async () =>
      makeAlerta({ tipo: 'sugerencia_reposicion', estado: 'resuelta' }),
    );
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }), {
      findById: async () =>
        makeAlerta({ tipo: 'sugerencia_reposicion', estado: 'activa' }),
      manualResolve,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/alertas/${ALERT_ID}/resolver`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
    // The role gate refuses before the handler ever reaches the service —
    // manualResolve must never have been invoked, so the alert row stays
    // untouched (CLAUDE.md: assert the database after a refusal).
    expect(manualResolve).not.toHaveBeenCalled();
  });

  it('returns 409 ALERT_NOT_MANUALLY_RESOLVABLE for an activa stock_bajo alert', async () => {
    app = await buildWithSession(makeUsuario(), {
      findById: async () =>
        makeAlerta({ tipo: 'stock_bajo', estado: 'activa' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/alertas/${ALERT_ID}/resolver`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ALERT_NOT_MANUALLY_RESOLVABLE');
  });

  it('rejects an id that is not a uuid with VALIDATION_ERROR', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'POST',
      url: '/api/alertas/not-a-uuid/resolver',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/alertas/marcar-vistas', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns { marcadas } from marcarVistas', async () => {
    app = await buildWithSession(makeUsuario(), {
      marcarVistas: async () => 4,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/alertas/marcar-vistas',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ marcadas: 4 });
  });
});
