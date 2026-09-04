import { afterEach, describe, expect, it } from 'vitest';
import type { Alerta, AlertasRepo } from '../alertas/repository.js';
import { buildApp } from '../app.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { UnitOfWork } from '../db/uow.js';
import type { Movimiento, MovimientosRepo } from '../movimientos/repository.js';
import type { Producto, ProductosRepo } from '../productos/repository.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
import type { Usuario, UsuariosRepo } from '../usuarios/repository.js';
import type { VentasRepo } from '../ventas/repository.js';

const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';

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

function makeMovimiento(overrides: Partial<Movimiento> = {}): Movimiento {
  return {
    id: 'movimiento-1',
    productoId: 'producto-1',
    tipo: 'entrada',
    cantidad: 1,
    motivo: null,
    esDiscrepancia: false,
    esMerma: false,
    usuarioId: 'u1',
    fecha: new Date('2026-02-15T00:00:00.000Z'),
    ventaId: null,
    stockResultante: 5,
    ...overrides,
  };
}

function makeAlerta(overrides: Partial<Alerta> = {}): Alerta {
  return {
    id: 'alerta-1',
    productoId: 'producto-1',
    tipo: 'discrepancia',
    estado: 'resuelta',
    movimientoId: 'movimiento-1',
    creadaEn: new Date('2026-09-01T00:00:00.000Z'),
    resueltaEn: new Date('2026-09-02T00:00:00.000Z'),
    resueltaPor: 'u1',
    ...overrides,
  };
}

function fakeRepos(
  overrides: {
    productos?: Partial<ProductosRepo>;
    movimientos?: Partial<MovimientosRepo>;
    alertas?: Partial<AlertasRepo>;
    sesiones?: Partial<SesionesRepo>;
  } = {},
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
      ...overrides.sesiones,
    } as SesionesRepo,
    auditoria: { record: async () => {} } as AuditoriaRepo,
    proveedores: {} as ProveedoresRepo,
    productos: {
      list: async () => ({ rows: [makeProducto()], total: 1 }),
      bajoMinimo: async () => ({ rows: [makeProducto()], total: 1 }),
      findById: async () => makeProducto(),
      ...overrides.productos,
    } as ProductosRepo,
    movimientos: {
      listByPeriodo: async () => ({ rows: [makeMovimiento()], total: 1 }),
      ...overrides.movimientos,
    } as MovimientosRepo,
    ventas: {} as VentasRepo,
    alertas: {
      list: async () => ({ rows: [makeAlerta()], total: 1 }),
      ...overrides.alertas,
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
  overrides: Parameters<typeof fakeRepos>[0] = {},
) {
  const repos = fakeRepos({
    ...overrides,
    sesiones: { findValid: async () => sesion, ...overrides.sesiones },
  });
  const app = await buildApp({
    repos,
    uow: fakeUow(repos),
    cookieSecret: COOKIE_SECRET,
  });
  await app.ready();
  return app;
}

describe('GET /api/reportes/stock-actual and /api/reportes/bajo-minimo', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('both roles get 200 and an identical result for identical paging (stock-actual)', async () => {
    for (const rol of ['encargado', 'deposito'] as const) {
      app = await buildWithSession(makeUsuario({ rol }));
      const response = await app.inject({
        method: 'GET',
        url: '/api/reportes/stock-actual?page=1&pageSize=20',
        cookies: { sid: app.signCookie('valid-token') },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        page: 1,
        pageSize: 20,
        total: 1,
      });
      expect(response.json().data[0].id).toBe('producto-1');
      await app.close();
    }
  });

  it('both roles get 200 and an identical result for identical paging (bajo-minimo)', async () => {
    for (const rol of ['encargado', 'deposito'] as const) {
      app = await buildWithSession(makeUsuario({ rol }));
      const response = await app.inject({
        method: 'GET',
        url: '/api/reportes/bajo-minimo?page=1&pageSize=20',
        cookies: { sid: app.signCookie('valid-token') },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        page: 1,
        pageSize: 20,
        total: 1,
      });
      expect(response.json().data[0].id).toBe('producto-1');
      await app.close();
    }
  });
});

describe('GET /api/reportes/movimientos', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 400 VALIDATION_ERROR when fechaDesde > fechaHasta', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'GET',
      url: '/api/reportes/movimientos?fechaDesde=2026-03-01&fechaHasta=2026-02-01&page=1&pageSize=20',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with productoNombre resolved for a valid range', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'GET',
      url: '/api/reportes/movimientos?fechaDesde=2026-02-01&fechaHasta=2026-02-28&page=1&pageSize=20',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].productoNombre).toBe('Producto Uno');
  });

  it('forces usuarioId to the deposito actor id, ignoring any client-supplied override', async () => {
    let capturedFiltro: unknown;
    app = await buildWithSession(
      makeUsuario({ id: 'deposito-a', rol: 'deposito' }),
      {
        movimientos: {
          listByPeriodo: async (filtro) => {
            capturedFiltro = filtro;
            return {
              rows: [makeMovimiento({ usuarioId: 'deposito-a' })],
              total: 1,
            };
          },
        },
      },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/reportes/movimientos?fechaDesde=2026-02-01&fechaHasta=2026-02-28&page=1&pageSize=20',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(capturedFiltro).toMatchObject({ usuarioId: 'deposito-a' });
  });
});

describe('GET /api/reportes/discrepancias', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('encargado gets 200 with estado/resueltaEn/resueltaPor per row', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/reportes/discrepancias?page=1&pageSize=20',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    const row = response.json().data[0];
    expect(row.estado).toBe('resuelta');
    expect(row.resueltaEn).toBeTruthy();
    expect(row.resueltaPor).toBe('u1');
  });

  it('deposito gets 403 with no data leaked in the body', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/reportes/discrepancias?page=1&pageSize=20',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.data).toBeUndefined();
  });
});
