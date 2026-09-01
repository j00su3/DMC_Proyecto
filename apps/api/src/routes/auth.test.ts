import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import { hashPassword } from '../auth/password.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { MovimientosRepo } from '../movimientos/repository.js';
import { PROXY_SECRET_HEADER } from '../plugins/clientIp.js';
import type { ProductosRepo } from '../productos/repository.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
import type { Usuario, UsuariosRepo } from '../usuarios/repository.js';
import type { VentasRepo } from '../ventas/repository.js';

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
    debeCambiarPassword: false,
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
    proveedores: {} as ProveedoresRepo,
    productos: {} as ProductosRepo,
    movimientos: {} as MovimientosRepo,
    ventas: {} as VentasRepo,
  };
}

// `POST /api/auth/password` runs through `app.uow` (design.md D1/D4), not
// `app.repos` directly. This fake mimics `db.transaction`: the callback's
// repos are the same fakes returned by `fakeRepos`.
function fakeUow(repos: ReturnType<typeof fakeRepos>) {
  return {
    async run<T>(work: (r: typeof repos) => Promise<T>): Promise<T> {
      return work(repos);
    },
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

  // SECURITY-REPORT.md S05: `secure` used to default to `false` whenever
  // NODE_ENV was not exactly 'production' — including when it was simply
  // unset, e.g. a manual deploy or a platform migration that forgets the
  // variable. It now defaults to `true` unconditionally.
  it('still emits Secure on the session cookie when NODE_ENV is unset', async () => {
    vi.stubEnv('NODE_ENV', undefined);
    try {
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
      const setCookie = response.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toMatch(/Secure/i);
    } finally {
      vi.unstubAllEnvs();
    }
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

  // SECURITY-REPORT.md S01, owner-ratified resolution: the informative 423
  // (with retryAfter) is reserved for the caller who has PROVEN they know
  // the account's password — the account's own owner. Only a correct
  // password against a locked account reaches this branch.
  it('returns 423 ACCOUNT_LOCKED with details.retryAfter for a locked account given the CORRECT password', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuario = makeUsuario({
      hashContrasena: hash,
      bloqueadoHasta: new Date(Date.now() + 120_000),
    });
    app = await buildApp({
      repos: fakeRepos({ findByEmail: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: PASSWORD },
    });

    expect(response.statusCode).toBe(423);
    const payload = response.json();
    expect(payload.error.code).toBe('ACCOUNT_LOCKED');
    expect(typeof payload.error.details.retryAfter).toBe('number');
  });

  // SECURITY-REPORT.md S01: a WRONG password against a locked, known
  // account must be indistinguishable from an unknown email — the status
  // code was the enumeration oracle DUMMY_HASH's timing equalization never
  // covered. Same code, same message, no `details` key on either side.
  it('returns 401 INVALID_CREDENTIALS (not 423) for a locked account given a WRONG password', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuario = makeUsuario({
      hashContrasena: hash,
      bloqueadoHasta: new Date(Date.now() + 120_000),
    });
    app = await buildApp({
      repos: fakeRepos({ findByEmail: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: usuario.email, password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    const payload = response.json();
    expect(payload.error.code).toBe('INVALID_CREDENTIALS');
    expect(payload.error.details).toBeUndefined();
  });

  // SECURITY-REPORT.md S01 Suggested Verification + S11: the byte-for-byte
  // comparison that proves the enumeration oracle is closed. A known email
  // with a wrong password against a LOCKED account must produce a response
  // body indistinguishable from an unknown email's — same status, same
  // envelope, field for field.
  it('produces a byte-for-byte identical response for an unknown email and a known-but-locked email with a wrong password', async () => {
    const hash = await hashPassword(PASSWORD);
    const lockedUsuario = makeUsuario({
      email: 'known@example.com',
      hashContrasena: hash,
      bloqueadoHasta: new Date(Date.now() + 120_000),
    });

    const unknownEmailApp = await buildApp({
      repos: fakeRepos({ findByEmail: async () => undefined }),
      cookieSecret: COOKIE_SECRET,
    });
    const unknownResponse = await unknownEmailApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'unknown@example.com', password: 'wrong-password' },
    });
    await unknownEmailApp.close();

    const lockedApp = await buildApp({
      repos: fakeRepos({ findByEmail: async () => lockedUsuario }),
      cookieSecret: COOKIE_SECRET,
    });
    const lockedResponse = await lockedApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: lockedUsuario.email,
        password: 'wrong-password',
      },
    });
    await lockedApp.close();

    expect(lockedResponse.statusCode).toBe(unknownResponse.statusCode);
    expect(lockedResponse.statusCode).toBe(401);
    expect(lockedResponse.json()).toEqual(unknownResponse.json());
    expect(lockedResponse.body).toBe(unknownResponse.body);
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

  // SEC-003's own "Suggested verification", verbatim: two requests with
  // different X-Forwarded-For values over the same socket, asserting what the
  // counting key actually is. The Render origin answers directly, so this is
  // the shape of a real bypass attempt — and without the shared secret the two
  // forged values must land in ONE bucket, not two.
  it('counts two forged X-Forwarded-For values against a single bucket (SEC-003)', async () => {
    app = await buildApp({
      repos: fakeRepos({ findByEmail: async () => undefined }),
      cookieSecret: COOKIE_SECRET,
      rateLimitMax: 1,
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '203.0.113.1' },
      payload: { email: 'unknown@example.com', password: 'anything' },
    });
    expect(first.statusCode).toBe(401);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '203.0.113.2' },
      payload: { email: 'unknown@example.com', password: 'anything' },
    });

    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('RATE_LIMITED');
  });

  it('gives each forwarded client its own bucket once the proxy secret is presented (SEC-003)', async () => {
    vi.stubEnv('PROXY_SHARED_SECRET', 'test-shared-secret');
    app = await buildApp({
      repos: fakeRepos({ findByEmail: async () => undefined }),
      cookieSecret: COOKIE_SECRET,
      rateLimitMax: 1,
    });
    const proxied = (ip: string) => ({
      'x-forwarded-for': ip,
      [PROXY_SECRET_HEADER]: 'test-shared-secret',
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: proxied('203.0.113.1'),
      payload: { email: 'unknown@example.com', password: 'anything' },
    });
    const otherClient = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: proxied('203.0.113.2'),
      payload: { email: 'unknown@example.com', password: 'anything' },
    });
    const sameClientAgain = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: proxied('203.0.113.1'),
      payload: { email: 'unknown@example.com', password: 'anything' },
    });

    // A real second client is not punished for the first one's traffic...
    expect(first.statusCode).toBe(401);
    expect(otherClient.statusCode).toBe(401);
    // ...and the first client is still counted.
    expect(sameClientAgain.statusCode).toBe(429);
    vi.unstubAllEnvs();
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

  it('includes debeCambiarPassword in the usuario DTO', async () => {
    const usuario = makeUsuario({ debeCambiarPassword: true });
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
    expect(response.json().usuario.debeCambiarPassword).toBe(true);
  });

  it('is reachable for a user with debeCambiarPassword: true (opts in)', async () => {
    const usuario = makeUsuario({ debeCambiarPassword: true });
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
  });
});

describe('POST /api/auth/password', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 200 on a successful password change', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuario = makeUsuario({ hashContrasena: hash });
    const repos = fakeRepos(
      { updatePassword: async () => {} },
      { findValid: async () => usuario, deleteOthers: async () => {} },
    );
    app = await buildApp({
      repos,
      uow: fakeUow(repos),
      cookieSecret: COOKIE_SECRET,
    });
    await app.ready();
    const signed = app.signCookie('valid-token');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { sid: signed },
      payload: {
        currentPassword: PASSWORD,
        newPassword: 'a-brand-new-password',
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 400 INVALID_CURRENT_PASSWORD for a wrong current password', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuario = makeUsuario({ hashContrasena: hash });
    app = await buildApp({
      repos: fakeRepos({}, { findValid: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });
    await app.ready();
    const signed = app.signCookie('valid-token');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { sid: signed },
      payload: {
        currentPassword: 'totally-wrong',
        newPassword: 'a-brand-new-password',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_CURRENT_PASSWORD');
  });

  it('returns 400 VALIDATION_ERROR for an empty new password', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuario = makeUsuario({ hashContrasena: hash });
    app = await buildApp({
      repos: fakeRepos({}, { findValid: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });
    await app.ready();
    const signed = app.signCookie('valid-token');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { sid: signed },
      payload: { currentPassword: PASSWORD, newPassword: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when the new password matches the current one', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuario = makeUsuario({ hashContrasena: hash });
    app = await buildApp({
      repos: fakeRepos({}, { findValid: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });
    await app.ready();
    const signed = app.signCookie('valid-token');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { sid: signed },
      payload: { currentPassword: PASSWORD, newPassword: PASSWORD },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('is reachable for a user with debeCambiarPassword: true (opts in)', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuario = makeUsuario({
      hashContrasena: hash,
      debeCambiarPassword: true,
    });
    const repos = fakeRepos(
      { updatePassword: async () => {} },
      { findValid: async () => usuario, deleteOthers: async () => {} },
    );
    app = await buildApp({
      repos,
      uow: fakeUow(repos),
      cookieSecret: COOKIE_SECRET,
    });
    await app.ready();
    const signed = app.signCookie('valid-token');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { sid: signed },
      payload: {
        currentPassword: PASSWORD,
        newPassword: 'a-brand-new-password',
      },
    });

    expect(response.statusCode).toBe(200);
  });

  // SECURITY-REPORT.md S02: two argon2 operations (verify + hash) per
  // request, reachable by any authenticated session including `deposito`,
  // with no rate limit. Exercises the REAL @fastify/rate-limit plugin
  // (max: 1 on this instance), not the error-envelope builder in isolation —
  // same approach as /auth/login's own 429 test above.
  it('returns 429 RATE_LIMITED when the per-session rate limit is exceeded', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuario = makeUsuario({ hashContrasena: hash });
    const repos = fakeRepos(
      { updatePassword: async () => {} },
      { findValid: async () => usuario, deleteOthers: async () => {} },
    );
    app = await buildApp({
      repos,
      uow: fakeUow(repos),
      cookieSecret: COOKIE_SECRET,
      rateLimitMax: 1,
    });
    await app.ready();
    const signed = app.signCookie('valid-token');

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { sid: signed },
      payload: {
        currentPassword: PASSWORD,
        newPassword: 'a-brand-new-password',
      },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { sid: signed },
      payload: {
        currentPassword: PASSWORD,
        newPassword: 'another-new-password',
      },
    });

    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('RATE_LIMITED');
  });

  // The whole point of S02's fix: keyed by session, not IP. Two DIFFERENT
  // sessions from the same address must not share one bucket, or a shared
  // office/NAT would let one deposito account's traffic lock out another's.
  it('keys the limit by session, not IP — a second session is unaffected', async () => {
    const hash = await hashPassword(PASSWORD);
    const usuarioA = makeUsuario({ id: 'u1', hashContrasena: hash });
    const usuarioB = makeUsuario({ id: 'u2', hashContrasena: hash });
    const sessionsById: Record<string, Usuario> = {
      'token-a': usuarioA,
      'token-b': usuarioB,
    };
    const repos = fakeRepos(
      { updatePassword: async () => {} },
      {
        findValid: async (token: string) => sessionsById[token],
        deleteOthers: async () => {},
      },
    );
    app = await buildApp({
      repos,
      uow: fakeUow(repos),
      cookieSecret: COOKIE_SECRET,
      rateLimitMax: 1,
    });
    await app.ready();

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { sid: app.signCookie('token-a') },
      payload: {
        currentPassword: PASSWORD,
        newPassword: 'a-brand-new-password',
      },
    });
    expect(first.statusCode).toBe(200);

    const secondSessionSameIp = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { sid: app.signCookie('token-b') },
      payload: {
        currentPassword: PASSWORD,
        newPassword: 'yet-another-password',
      },
    });

    expect(secondSessionSameIp.statusCode).toBe(200);
  });
});

describe('forced-password-change allowlist reaches routes.ts', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 403 PASSWORD_CHANGE_REQUIRED for an unrelated protected route when debeCambiarPassword is true', async () => {
    const usuario = makeUsuario({ debeCambiarPassword: true });
    app = await buildApp({
      repos: fakeRepos({}, { findValid: async () => usuario }),
      cookieSecret: COOKIE_SECRET,
    });
    app.get('/api/some-other-protected-route', async () => ({ ok: true }));
    await app.ready();
    const signed = app.signCookie('valid-token');

    const response = await app.inject({
      method: 'GET',
      url: '/api/some-other-protected-route',
      cookies: { sid: signed },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});
