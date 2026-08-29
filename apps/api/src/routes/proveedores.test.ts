import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { UnitOfWork } from '../db/uow.js';
import type { MovimientosRepo } from '../movimientos/repository.js';
import type { ProductosRepo } from '../productos/repository.js';
import type { Proveedor, ProveedoresRepo } from '../proveedores/repository.js';
import type { Usuario, UsuariosRepo } from '../usuarios/repository.js';

const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

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
    id: TARGET_ID,
    nombre: 'Distribuidora Norte',
    contacto: 'contacto@example.com',
    activo: true,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeRepos(
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
      findById: async () => undefined,
      findByIdForUpdate: async () => makeProveedor(),
      create: async () => makeProveedor(),
      update: async () => makeProveedor(),
      setActivo: async () => makeProveedor(),
      ...proveedores,
    } as ProveedoresRepo,
    productos: {} as ProductosRepo,
    movimientos: {} as MovimientosRepo,
  };
}

// Mirrors usuarios.test.ts's fakeUow: `uow.run` hands the callback the SAME
// fakes, so write routes reach the same stubs this suite configured.
function fakeUow(repos: ReturnType<typeof fakeRepos>): UnitOfWork {
  return {
    async run(work) {
      return work(repos as never);
    },
  };
}

async function buildWithSession(
  sesion: Usuario | undefined,
  proveedores: Partial<ProveedoresRepo> = {},
  auditoria: Partial<AuditoriaRepo> = {},
) {
  const repos = fakeRepos(proveedores, { findValid: async () => sesion });
  if (auditoria.record) {
    repos.auditoria.record = auditoria.record;
  }
  const app = await buildApp({
    repos,
    uow: fakeUow(repos),
    cookieSecret: COOKIE_SECRET,
  });
  await app.ready();
  return app;
}

// The six routes this slice adds, described once and reused across the
// role-gate matrix below rather than re-listed per assertion.
const readRoutes = [
  { method: 'GET' as const, url: () => '/api/proveedores' },
  { method: 'GET' as const, url: () => `/api/proveedores/${TARGET_ID}` },
];

const writeRoutes = [
  {
    method: 'POST' as const,
    url: () => '/api/proveedores',
    payload: () => ({ nombre: 'Nueva Distribuidora' }),
  },
  {
    method: 'PATCH' as const,
    url: () => `/api/proveedores/${TARGET_ID}`,
    payload: () => ({ nombre: 'Nueva Distribuidora' }),
  },
  {
    method: 'POST' as const,
    url: () => `/api/proveedores/${TARGET_ID}/deactivate`,
    payload: () => undefined,
  },
  {
    method: 'POST' as const,
    url: () => `/api/proveedores/${TARGET_ID}/reactivate`,
    payload: () => undefined,
  },
];

describe('Role Gate — Read/Write Split on Every Supplier-Management Route', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  // D6: this 403 is a genuine server-side authorization boundary, not a UI
  // affordance — the same hook that gates /usuarios refuses a deposito
  // write here before any handler runs.
  it('returns 200 for a deposito session on both GET routes', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }), {
      findById: async () => makeProveedor(),
    });
    const cookies = { sid: app.signCookie('valid-token') };

    for (const route of readRoutes) {
      const response = await app.inject({
        method: route.method,
        url: route.url(),
        cookies,
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it('returns 403 FORBIDDEN for a deposito session on all four write routes', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));
    const cookies = { sid: app.signCookie('valid-token') };

    for (const route of writeRoutes) {
      const response = await app.inject({
        method: route.method,
        url: route.url(),
        payload: route.payload(),
        cookies,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    }
  });

  it('returns 401 UNAUTHORIZED without a session on all six routes', async () => {
    app = await buildWithSession(undefined);

    for (const route of [...readRoutes, ...writeRoutes]) {
      const response = await app.inject({
        method: route.method,
        url: route.url(),
        payload: 'payload' in route ? route.payload() : undefined,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    }
  });

  // D6: the forced-password-change check runs before the roles check, so a
  // flagged deposito user gets PASSWORD_CHANGE_REQUIRED even on a GET.
  it('returns 403 PASSWORD_CHANGE_REQUIRED for a flagged user on all six routes', async () => {
    app = await buildWithSession(makeUsuario({ debeCambiarPassword: true }));
    const cookies = { sid: app.signCookie('valid-token') };

    for (const route of [...readRoutes, ...writeRoutes]) {
      const response = await app.inject({
        method: route.method,
        url: route.url(),
        payload: 'payload' in route ? route.payload() : undefined,
        cookies,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
  });
});

describe('GET /api/proveedores', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('defaults to page 1 and pageSize 20 and returns the paginated envelope', async () => {
    app = await buildWithSession(makeUsuario(), {
      list: async () => ({ rows: [makeProveedor()], total: 1 }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/proveedores',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(response.json().data).toHaveLength(1);
  });
});

describe('GET /api/proveedores/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 200 with the proveedor for an encargado session', async () => {
    app = await buildWithSession(makeUsuario(), {
      findById: async () => makeProveedor(),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/proveedores/${TARGET_ID}`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().proveedor.id).toBe(TARGET_ID);
  });

  it('returns 404 SUPPLIER_NOT_FOUND for an id that matches no row', async () => {
    app = await buildWithSession(makeUsuario(), {
      findById: async () => undefined,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/proveedores/${TARGET_ID}`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SUPPLIER_NOT_FOUND');
  });

  it('rejects an id that is not a uuid with VALIDATION_ERROR', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'GET',
      url: '/api/proveedores/not-a-uuid',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/proveedores', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 201 with the created proveedor', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: {
        nombre: 'Distribuidora Norte',
        contacto: 'contacto@example.com',
      },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().proveedor.nombre).toBe('Distribuidora Norte');
  });

  it('accepts a body omitting contacto', async () => {
    app = await buildWithSession(makeUsuario(), {
      create: async () => makeProveedor({ contacto: null }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Distribuidora Norte' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().proveedor.contacto).toBeNull();
  });

  // D3: trimmed at the Zod boundary, so an all-whitespace nombre becomes
  // empty AFTER trim and fails the min(1) check that runs on the trimmed
  // value.
  it('rejects an all-whitespace nombre with VALIDATION_ERROR', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: '   ' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('maps a duplicate name to 409 SUPPLIER_NAME_IN_USE', async () => {
    const { supplierNameInUse } = await import('../lib/errors.js');
    app = await buildWithSession(makeUsuario(), {
      create: async () => {
        throw supplierNameInUse();
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Distribuidora Norte' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SUPPLIER_NAME_IN_USE');
  });
});

describe('PATCH /api/proveedores/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const url = `/api/proveedores/${TARGET_ID}`;

  // D11: `.strict()` is the load-bearing part — deactivation is its own
  // route so the audit verb is never derived from a patch shape.
  it('rejects an activo key with VALIDATION_ERROR before any handler runs', async () => {
    let handlerReached = false;
    app = await buildWithSession(makeUsuario(), {
      findByIdForUpdate: async () => {
        handlerReached = true;
        return makeProveedor();
      },
    });

    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: { nombre: 'Nuevo Nombre', activo: false },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(handlerReached).toBe(false);
  });

  it('rejects an empty body with VALIDATION_ERROR', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: {},
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  // D11: contacto is nullable, not a third spelling via empty string —
  // null clears it, '' is rejected.
  it('accepts contacto: null and rejects contacto: "" with VALIDATION_ERROR', async () => {
    app = await buildWithSession(makeUsuario(), {
      update: async (_id, cambios) =>
        makeProveedor({ contacto: cambios.contacto ?? null }),
    });
    const cookies = { sid: app.signCookie('valid-token') };

    const nullResponse = await app.inject({
      method: 'PATCH',
      url,
      payload: { contacto: null },
      cookies,
    });
    expect(nullResponse.statusCode).toBe(200);
    expect(nullResponse.json().proveedor.contacto).toBeNull();

    const emptyResponse = await app.inject({
      method: 'PATCH',
      url,
      payload: { contacto: '' },
      cookies,
    });
    expect(emptyResponse.statusCode).toBe(400);
    expect(emptyResponse.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with the updated proveedor', async () => {
    app = await buildWithSession(makeUsuario(), {
      update: async () => makeProveedor({ nombre: 'Nuevo Nombre' }),
    });

    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: { nombre: 'Nuevo Nombre' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().proveedor.nombre).toBe('Nuevo Nombre');
  });

  it('returns 404 SUPPLIER_NOT_FOUND for an id that matches no row', async () => {
    app = await buildWithSession(makeUsuario(), {
      findByIdForUpdate: async () => undefined,
    });

    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: { nombre: 'Nadie' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SUPPLIER_NOT_FOUND');
  });
});

describe('POST /api/proveedores/:id/deactivate and /reactivate', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const deactivateUrl = `/api/proveedores/${TARGET_ID}/deactivate`;
  const reactivateUrl = `/api/proveedores/${TARGET_ID}/reactivate`;

  it('deactivates and returns the updated proveedor', async () => {
    app = await buildWithSession(makeUsuario(), {
      setActivo: async () => makeProveedor({ activo: false }),
    });

    const response = await app.inject({
      method: 'POST',
      url: deactivateUrl,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().proveedor.activo).toBe(false);
  });

  it('reactivates and returns the updated proveedor', async () => {
    app = await buildWithSession(makeUsuario(), {
      findByIdForUpdate: async () => makeProveedor({ activo: false }),
      setActivo: async () => makeProveedor({ activo: true }),
    });

    const response = await app.inject({
      method: 'POST',
      url: reactivateUrl,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().proveedor.activo).toBe(true);
  });

  it('returns 404 SUPPLIER_NOT_FOUND on both routes for an unknown id', async () => {
    app = await buildWithSession(makeUsuario(), {
      findByIdForUpdate: async () => undefined,
    });
    const cookies = { sid: app.signCookie('valid-token') };

    for (const url of [deactivateUrl, reactivateUrl]) {
      const response = await app.inject({ method: 'POST', url, cookies });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('SUPPLIER_NOT_FOUND');
    }
  });
});
