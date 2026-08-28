import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type {
  Usuario,
  UsuarioResumen,
  UsuariosRepo,
} from '../usuarios/repository.js';

const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const TARGET_ID = '11111111-1111-4111-8111-111111111111';

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

function makeResumen(overrides: Partial<UsuarioResumen> = {}): UsuarioResumen {
  return {
    id: TARGET_ID,
    nombre: 'Ana Encargada',
    email: 'ana@example.com',
    rol: 'encargado',
    activo: true,
    debeCambiarPassword: false,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeRepos(
  usuarios: Partial<UsuariosRepo> = {},
  sesiones: Partial<SesionesRepo> = {},
) {
  return {
    usuarios: {
      findByEmail: async () => undefined,
      registerFailedAttempt: async () => ({
        intentosFallidos: 1,
        bloqueadoHasta: null,
      }),
      resetAttempts: async () => {},
      updatePassword: async () => {},
      list: async () => ({ rows: [], total: 0 }),
      findById: async () => undefined,
      ...usuarios,
    } as UsuariosRepo,
    sesiones: {
      create: async () => {},
      findValid: async () => undefined,
      delete: async () => {},
      purgeExpired: async () => {},
      deleteOthers: async () => {},
      ...sesiones,
    } as SesionesRepo,
    auditoria: { record: async () => {} } as AuditoriaRepo,
  };
}

// Builds an app whose session resolves to `sesion`, so the RBAC hook sees a
// real user. `findValid` is the only seam the hook consults.
async function buildWithSession(
  sesion: Usuario | undefined,
  usuarios: Partial<UsuariosRepo> = {},
) {
  const app = await buildApp({
    repos: fakeRepos(usuarios, { findValid: async () => sesion }),
    cookieSecret: COOKIE_SECRET,
  });
  await app.ready();
  return app;
}

describe('GET /api/usuarios', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 401 UNAUTHORIZED without a session', async () => {
    app = await buildWithSession(undefined);

    const response = await app.inject({ method: 'GET', url: '/api/usuarios' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 FORBIDDEN for a deposito session', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/usuarios',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('defaults to page 1 and pageSize 20 and returns the paginated envelope', async () => {
    app = await buildWithSession(makeUsuario(), {
      list: async () => ({ rows: [makeResumen()], total: 1 }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/usuarios',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(response.json().data).toHaveLength(1);
  });

  it('passes explicit page and pageSize through to the repo and echoes them', async () => {
    const seen: { page?: number; pageSize?: number } = {};
    app = await buildWithSession(makeUsuario(), {
      list: async (page: number, pageSize: number) => {
        seen.page = page;
        seen.pageSize = pageSize;
        return { rows: [], total: 0 };
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/usuarios?page=3&pageSize=5',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    // Echoed AND actually applied — asserting only the echo would pass on a
    // handler that ignores the query and always reads page 1.
    expect(seen).toEqual({ page: 3, pageSize: 5 });
    expect(response.json()).toMatchObject({ page: 3, pageSize: 5 });
  });

  it('never serialises hashContrasena, even when the repo leaks it', async () => {
    // The DTO is the last line of defence. D15 keeps the hash out of the
    // projection, but a response schema that passes rows through unfiltered
    // would surface whatever a future repo change starts returning.
    app = await buildWithSession(makeUsuario(), {
      list: async () =>
        ({
          rows: [{ ...makeResumen(), hashContrasena: 'leaked-hash' }],
          total: 1,
        }) as unknown as { rows: UsuarioResumen[]; total: number },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/usuarios',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('leaked-hash');
    expect(response.body).not.toContain('hashContrasena');
  });
});

describe('GET /api/usuarios/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 401 UNAUTHORIZED without a session', async () => {
    app = await buildWithSession(undefined);

    const response = await app.inject({
      method: 'GET',
      url: `/api/usuarios/${TARGET_ID}`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 FORBIDDEN for a deposito session', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));

    const response = await app.inject({
      method: 'GET',
      url: `/api/usuarios/${TARGET_ID}`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('returns 200 with the usuario for an encargado session', async () => {
    app = await buildWithSession(makeUsuario(), {
      findById: async () => makeResumen(),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/usuarios/${TARGET_ID}`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().usuario.id).toBe(TARGET_ID);
  });

  it('returns 404 USER_NOT_FOUND for an id that matches no row', async () => {
    app = await buildWithSession(makeUsuario(), {
      findById: async () => undefined,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/usuarios/${TARGET_ID}`,
      cookies: { sid: app.signCookie('valid-token') },
    });

    // Not the app-wide NOT_FOUND of setNotFoundHandler: the route matched,
    // the row did not. Distinguishing them is what tells the SPA whether it
    // called a wrong URL or asked for a user that is gone.
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('USER_NOT_FOUND');
  });

  it('rejects an id that is not a uuid with VALIDATION_ERROR', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'GET',
      url: '/api/usuarios/not-a-uuid',
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});
