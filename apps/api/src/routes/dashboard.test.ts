import { afterEach, describe, expect, it } from 'vitest';
import type { AlertasRepo } from '../alertas/repository.js';
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
      findById: async () => makeProducto(),
      ...overrides.productos,
    } as ProductosRepo,
    movimientos: {
      listRecientes: async () => [makeMovimiento()],
      ...overrides.movimientos,
    } as MovimientosRepo,
    ventas: {} as VentasRepo,
    alertas: {
      countAbiertasPorTipo: async () => 1,
      countAbiertas: async () => 4,
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

describe('GET /api/dashboard/resumen', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('both roles get 200 with an identical payload shape (D4, no querystring schema)', async () => {
    for (const rol of ['encargado', 'deposito'] as const) {
      app = await buildWithSession(makeUsuario({ rol }));
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/resumen',
        cookies: { sid: app.signCookie('valid-token') },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        quiebres: 1,
        stockBajo: 1,
        alertasActivas: 4,
      });
      expect(response.json().actividadReciente[0]).toMatchObject({
        id: 'movimiento-1',
        productoId: 'producto-1',
        productoNombre: 'Producto Uno',
        tipo: 'entrada',
        usuarioId: 'u1',
      });
      await app.close();
    }
  });

  it('returns 401 UNAUTHORIZED without a session', async () => {
    app = await buildWithSession(undefined);

    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/resumen',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });
});
