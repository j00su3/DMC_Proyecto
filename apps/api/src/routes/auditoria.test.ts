import { afterEach, describe, expect, it } from 'vitest';
import type { AlertasRepo } from '../alertas/repository.js';
import { buildApp } from '../app.js';
import type {
  AuditoriaRepo,
  FiltroAuditoria,
} from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { UnitOfWork } from '../db/uow.js';
import type { ProductosRepo } from '../productos/repository.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
import type { Usuario, UsuariosRepo } from '../usuarios/repository.js';

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

const baseRegistro = {
  id: 'registro-1',
  entidad: 'productos' as const,
  entidadId: 'producto-1',
  accion: 'actualizar' as const,
  usuarioId: 'u1',
  datosPrevios: { nombre: 'Antes' },
  datosPosteriores: { nombre: 'Despues' },
  creadoEn: new Date('2026-02-01T00:00:00.000Z'),
};

function fakeRepos(
  overrides: {
    auditoria?: Partial<AuditoriaRepo>;
    usuarios?: Partial<UsuariosRepo>;
    proveedores?: Partial<ProveedoresRepo>;
    productos?: Partial<ProductosRepo>;
    alertas?: Partial<AlertasRepo>;
    sesiones?: Partial<SesionesRepo>;
  } = {},
) {
  return {
    usuarios: {
      findManyByIds: async (ids: string[]) =>
        ids.includes('u1') ? [{ id: 'u1', nombre: 'Ana' }] : [],
      ...overrides.usuarios,
    } as UsuariosRepo,
    sesiones: {
      create: async () => {},
      findValid: async () => undefined,
      delete: async () => {},
      purgeExpired: async () => {},
      deleteOthers: async () => {},
      deleteAllForUser: async () => {},
      ...overrides.sesiones,
    } as SesionesRepo,
    auditoria: {
      record: async () => {},
      list: async () => ({ rows: [baseRegistro], total: 1 }),
      ...overrides.auditoria,
    } as AuditoriaRepo,
    proveedores: {
      findManyByIds: async () => [],
      ...overrides.proveedores,
    } as ProveedoresRepo,
    productos: {
      findManyByIds: async (ids: string[]) =>
        ids.includes('producto-1')
          ? [{ id: 'producto-1', nombre: 'Harina' }]
          : [],
      ...overrides.productos,
    } as ProductosRepo,
    movimientos: {} as never,
    ventas: {} as never,
    alertas: {
      findManyByIds: async () => [],
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

describe('GET /api/auditoria', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('encargado gets 200 with the paginated envelope', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/auditoria?page=1&pageSize=20',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(response.json().data[0].id).toBe('registro-1');
  });

  it('deposito gets 403 with no data key in the body', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/auditoria?page=1&pageSize=20',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.data).toBeUndefined();
  });

  it('rejects entidadId without entidad with 400 VALIDATION_ERROR', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }));

    const response = await app.inject({
      method: 'GET',
      url: `/api/auditoria?page=1&pageSize=20&entidadId=${'a3b1c2d3-0000-4000-8000-000000000001'}`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('composes all three filters into the FiltroAuditoria passed to the repo', async () => {
    let capturedFiltro: FiltroAuditoria | undefined;
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }), {
      auditoria: {
        list: async (filtro) => {
          capturedFiltro = filtro;
          return { rows: [baseRegistro], total: 1 };
        },
      },
    });

    const entidadId = 'a3b1c2d3-0000-4000-8000-000000000001';
    const usuarioId = 'a3b1c2d3-0000-4000-8000-000000000002';
    const response = await app.inject({
      method: 'GET',
      url: `/api/auditoria?page=1&pageSize=20&entidad=productos&entidadId=${entidadId}&usuarioId=${usuarioId}`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(capturedFiltro).toMatchObject({
      entidad: 'productos',
      entidadId,
      usuarioId,
    });
  });

  it('response carries both raw ids and resolved labels', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'encargado' }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/auditoria?page=1&pageSize=20',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    const row = response.json().data[0];
    expect(row.usuarioId).toBe('u1');
    expect(row.usuarioNombre).toBe('Ana');
    expect(row.entidadId).toBe('producto-1');
    expect(row.entidadEtiqueta).toBe('Harina');
    expect(row.datosPrevios).toEqual({ nombre: 'Antes' });
    expect(row.datosPosteriores).toEqual({ nombre: 'Despues' });
  });
});
