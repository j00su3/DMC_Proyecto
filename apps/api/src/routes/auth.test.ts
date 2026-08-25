import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import type {
  SesionesRepo,
  Usuario,
  UsuariosRepo,
} from '../auth/repository.js';

const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const PASSWORD = 'correct-horse-battery-staple';

function makeUsuario(overrides: Partial<Usuario> = {}): Usuario {
  return {
    id: 'u1',
    nombre: 'Test User',
    email: 'test@example.com',
    hashContrasena: 'set-per-test',
    rol: 'deposito',
    activo: true,
    intentosFallidos: 0,
    bloqueadoHasta: null,
    creadoEn: new Date(),
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
      ...usuarios,
    } as UsuariosRepo,
    sesiones: {
      create: async () => {},
      findValid: async () => undefined,
      delete: async () => {},
      purgeExpired: async () => {},
      ...sesiones,
    } as SesionesRepo,
  };
}

describe('POST /api/auth/login', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 200 with the usuario and a Set-Cookie with the expected attributes on success', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuario = makeUsuario({ hashContrasena: hash });
    app = await buildApp({
      repos: fakeRepos({ findByEmail: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.usuario.id).toBe(usuario.id);
    expect(payload.usuario).not.toHaveProperty('hashContrasena');
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieStr).toMatch(/sid=/);
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/SameSite=Lax/i);
    expect(cookieStr).not.toMatch(/Domain=/i);
  });

  it('returns 401 INVALID_CREDENTIALS for a wrong password', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuario = makeUsuario({ hashContrasena: hash });
    app = await buildApp({
      repos: fakeRepos({ findByEmail: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: 'wrong' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 INVALID_CREDENTIALS for an unknown email (same shape as wrong password)', async () => {
    app = await buildApp({
      repos: fakeRepos({ findByEmail: async () => undefined }),
      cookieSecret: COOKIE_SECRET,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'unknown@example.com', password: 'anything' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 ACCOUNT_INACTIVE for an inactive user with correct credentials', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuario = makeUsuario({ hashContrasena: hash, activo: false });
    app = await buildApp({
      repos: fakeRepos({ findByEmail: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('returns 423 ACCOUNT_LOCKED with details.retryAfter for a locked account', async () => {
    const usuario = makeUsuario({
      bloqueadoHasta: new Date(Date.now() + 120_000),
    });
    app = await buildApp({
      repos: fakeRepos({ findByEmail: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: 'irrelevant' },
    });

    expect(response.statusCode).toBe(423);
    const payload = response.json();
    expect(payload.error.code).toBe('ACCOUNT_LOCKED');
    expect(typeof payload.error.details.retryAfter).toBe('number');
  });

  // Exercises the REAL @fastify/rate-limit plugin (max: 1 on this instance),
  // not the error-envelope builder in isolation (design.md Testing Strategy).
  it('returns 429 RATE_LIMITED when the IP rate limit is exceeded', async () => {
    app = await buildApp({
      repos: fakeRepos({ findByEmail: async () => undefined }),
      cookieSecret: COOKIE_SECRET,
      rateLimitMax: 1,
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'unknown@example.com', password: 'anything' },
    });
    expect(first.statusCode).toBe(401);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'unknown@example.com', password: 'anything' },
    });

    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /api/auth/logout', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 200 and clears the cookie when a valid session exists', async () => {
    const usuario = makeUsuario();
    app = await buildApp({
      repos: fakeRepos({}, { findValid: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });
    await app.ready();
    const signed = app.signCookie('some-token');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { sid: signed },
    });

    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieStr).toMatch(/sid=;/);
  });

  it('returns 200 with no error when there is no session cookie', async () => {
    app = await buildApp({ repos: fakeRepos(), cookieSecret: COOKIE_SECRET });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 200 with the usuario for a valid session', async () => {
    const usuario = makeUsuario();
    app = await buildApp({
      repos: fakeRepos({}, { findValid: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });
    await app.ready();
    const signed = app.signCookie('valid-token');

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { sid: signed },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().usuario.id).toBe(usuario.id);
  });

  it('returns 401 UNAUTHORIZED without a session', async () => {
    app = await buildApp({ repos: fakeRepos(), cookieSecret: COOKIE_SECRET });

    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });
});
