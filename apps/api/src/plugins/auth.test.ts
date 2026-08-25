import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type {
  SesionesRepo,
  Usuario,
  UsuariosRepo,
} from '../auth/repository.js';

const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';

function makeUsuario(overrides: Partial<Usuario> = {}): Usuario {
  return {
    id: 'u1',
    nombre: 'Test User',
    email: 'test@example.com',
    hashContrasena: 'irrelevant-for-this-test',
    rol: 'deposito',
    activo: true,
    intentosFallidos: 0,
    bloqueadoHasta: null,
    creadoEn: new Date(),
    debeCambiarPassword: false,
    ...overrides,
  };
}

function fakeRepos(sesiones: Partial<SesionesRepo> = {}) {
  return {
    usuarios: {} as UsuariosRepo,
    sesiones: {
      create: async () => {},
      findValid: async () => undefined,
      delete: async () => {},
      purgeExpired: async () => {},
      ...sesiones,
    } as SesionesRepo,
  };
}

describe('auth plugin (RBAC enforcement)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('denies an unconfigured route by default (401 UNAUTHORIZED)', async () => {
    app = await buildApp({ repos: fakeRepos(), cookieSecret: COOKIE_SECRET });
    // Registered after the auth plugin (buildApp registers it before its own
    // routes) — proves the default-deny hook applies to routes it never knew
    // about at registration time, not just to routes.ts's own paths.
    app.get('/api/private', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/private' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('allows a route that opts out with config: { auth: false }', async () => {
    app = await buildApp({ repos: fakeRepos(), cookieSecret: COOKIE_SECRET });
    app.get('/api/open', { config: { auth: false } }, async () => ({
      ok: true,
    }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/open' });

    expect(response.statusCode).toBe(200);
  });

  it('returns 403 FORBIDDEN when the session user role is not in config.roles', async () => {
    const usuario = makeUsuario({ rol: 'deposito' });
    app = await buildApp({
      repos: fakeRepos({ findValid: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });
    app.get(
      '/api/encargado-only',
      { config: { roles: ['encargado'] } },
      async () => ({ ok: true }),
    );
    await app.ready();

    const signed = app.signCookie('any-token-value');
    const response = await app.inject({
      method: 'GET',
      url: '/api/encargado-only',
      cookies: { sid: signed },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('allows the request through when the session role matches config.roles', async () => {
    const usuario = makeUsuario({ rol: 'encargado' });
    app = await buildApp({
      repos: fakeRepos({ findValid: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });
    app.get(
      '/api/encargado-only',
      { config: { roles: ['encargado'] } },
      async () => ({ ok: true }),
    );
    await app.ready();

    const signed = app.signCookie('any-token-value');
    const response = await app.inject({
      method: 'GET',
      url: '/api/encargado-only',
      cookies: { sid: signed },
    });

    expect(response.statusCode).toBe(200);
  });

  it('keeps unmatched routes as 404 instead of turning them into 401 (D8)', async () => {
    app = await buildApp({ repos: fakeRepos(), cookieSecret: COOKIE_SECRET });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/this-route-does-not-exist',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});
