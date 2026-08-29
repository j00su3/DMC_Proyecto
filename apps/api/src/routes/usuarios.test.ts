import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { UnitOfWork } from '../db/uow.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
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
      findByIdForUpdate: async () => makeResumen(),
      findLockoutState: async () => ({
        intentosFallidos: 0,
        bloqueadoHasta: null,
      }),
      lockActiveEncargados: async () => [],
      create: async () => makeResumen({ debeCambiarPassword: true }),
      update: async () => makeResumen(),
      setActivo: async () => makeResumen(),
      resetPassword: async () => makeResumen({ debeCambiarPassword: true }),
      ...usuarios,
    } as UsuariosRepo,
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
  };
}

// `uow.run` hands the callback the SAME fakes, mirroring what
// `createUnitOfWork` does with `buildRepos(tx)`. Without this the write
// routes would reach for repos this suite never configured.
function fakeUow(repos: ReturnType<typeof fakeRepos>): UnitOfWork {
  return {
    async run(work) {
      return work(repos as never);
    },
  };
}

// Builds an app whose session resolves to `sesion`, so the RBAC hook sees a
// real user. `findValid` is the only seam the hook consults.
async function buildWithSession(
  sesion: Usuario | undefined,
  usuarios: Partial<UsuariosRepo> = {},
  auditoria: Partial<AuditoriaRepo> = {},
) {
  const repos = fakeRepos(usuarios, { findValid: async () => sesion });
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
    // Two layers keep the hash out: the Zod response schema strips unknown
    // keys, and the DTO builds an explicit object. This asserts the OUTCOME
    // rather than either layer, which is why it survives a change to one of
    // them and fails only when both are gone.
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

describe('POST /api/usuarios', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const body = {
    nombre: 'Beto Deposito',
    email: 'beto@example.com',
    rol: 'deposito' as const,
  };

  it('returns 401 UNAUTHORIZED without a session', async () => {
    app = await buildWithSession(undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 FORBIDDEN for a deposito session', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: body,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('returns 201 with the usuario and a temporary password', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: body,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(201);
    const payload = response.json();
    expect(payload.usuario.id).toBe(TARGET_ID);
    expect(payload.usuario.debeCambiarPassword).toBe(true);
    expect(typeof payload.passwordTemporal).toBe('string');
    expect(payload.passwordTemporal).toHaveLength(16);
  });

  it('sets Cache-Control: no-store so the temporary password is never cached', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: body,
      cookies: { sid: app.signCookie('valid-token') },
    });

    // D8: the plaintext leaves once, in this body. A cache — browser, proxy
    // or CDN — holding that response is a second copy nobody accounted for.
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('maps a duplicate email to 409 EMAIL_ALREADY_IN_USE', async () => {
    const { emailAlreadyInUse } = await import('../lib/errors.js');
    app = await buildWithSession(makeUsuario(), {
      create: async () => {
        throw emailAlreadyInUse();
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: body,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EMAIL_ALREADY_IN_USE');
  });

  it('rejects a body missing nombre with VALIDATION_ERROR', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: { email: 'beto@example.com', rol: 'deposito' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed email with VALIDATION_ERROR', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: { ...body, email: 'not-an-email' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    // The contract advertises `format: email`. Accepting garbage here
    // creates a row whose owner cannot be reached and whose login the
    // encargado cannot reproduce.
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a rol outside the enum with VALIDATION_ERROR', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: { ...body, rol: 'administrador' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/usuarios/:id/password-reset', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const url = `/api/usuarios/${TARGET_ID}/password-reset`;

  it('returns 401 UNAUTHORIZED without a session', async () => {
    app = await buildWithSession(undefined);

    const response = await app.inject({ method: 'POST', url });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 FORBIDDEN for a deposito session', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));

    const response = await app.inject({
      method: 'POST',
      url,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('returns 200 with a temporary password and no-store', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'POST',
      url,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().passwordTemporal).toHaveLength(16);
    expect(response.json().usuario.debeCambiarPassword).toBe(true);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns 404 USER_NOT_FOUND for an id that matches no row', async () => {
    app = await buildWithSession(makeUsuario(), {
      findByIdForUpdate: async () => undefined,
    });

    const response = await app.inject({
      method: 'POST',
      url,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('USER_NOT_FOUND');
  });

  it('surfaces a failed audit write as 500 AUDIT_WRITE_FAILED and returns no password', async () => {
    app = await buildWithSession(
      makeUsuario(),
      {},
      {
        record: async () => {
          throw new Error('audit table unavailable');
        },
      },
    );

    const response = await app.inject({
      method: 'POST',
      url,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('AUDIT_WRITE_FAILED');
    // The temporary password must not reach the client on a failed write:
    // the transaction rolled back, so the credential it names does not exist
    // in the database and handing it over would be a lie the user acts on.
    expect(response.body).not.toContain('passwordTemporal');
  });
});

describe('the temporary password never appears on a read route', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('is absent from list and get responses', async () => {
    app = await buildWithSession(makeUsuario(), {
      list: async () => ({ rows: [makeResumen()], total: 1 }),
      findById: async () => makeResumen(),
    });
    const cookies = { sid: app.signCookie('valid-token') };

    const list = await app.inject({
      method: 'GET',
      url: '/api/usuarios',
      cookies,
    });
    const get = await app.inject({
      method: 'GET',
      url: `/api/usuarios/${TARGET_ID}`,
      cookies,
    });

    // usuarioConPasswordDto is disjoint from usuarioResumenDto (D8) — the
    // key exists on exactly two responses in the whole API.
    expect(list.body).not.toContain('passwordTemporal');
    expect(get.body).not.toContain('passwordTemporal');
  });
});

describe('PATCH /api/usuarios/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const url = `/api/usuarios/${TARGET_ID}`;

  it('returns 401 UNAUTHORIZED without a session', async () => {
    app = await buildWithSession(undefined);

    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: { nombre: 'Nuevo Nombre' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 FORBIDDEN for a deposito session', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));

    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: { nombre: 'Nuevo Nombre' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('rejects an activo key with VALIDATION_ERROR before any handler runs', async () => {
    let handlerReached = false;
    app = await buildWithSession(makeUsuario(), {
      findByIdForUpdate: async () => {
        handlerReached = true;
        return makeResumen();
      },
    });

    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: { nombre: 'Nuevo Nombre', activo: false },
      cookies: { sid: app.signCookie('valid-token') },
    });

    // D13: deactivation is its own route so the audit verb is never derived
    // from a patch shape. Rejecting the key at the Zod layer makes the
    // ambiguous request unreachable by construction — and `handlerReached`
    // is what proves it is rejected BEFORE the handler, not inside it.
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

  it('rejects an unknown key with VALIDATION_ERROR', async () => {
    app = await buildWithSession(makeUsuario());

    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: { nombre: 'Nuevo Nombre', rolSecreto: 'admin' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with the updated usuario', async () => {
    app = await buildWithSession(makeUsuario(), {
      update: async () => makeResumen({ nombre: 'Nuevo Nombre' }),
    });

    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: { nombre: 'Nuevo Nombre' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().usuario.nombre).toBe('Nuevo Nombre');
  });

  it('maps the guard to 409 LAST_ACTIVE_ENCARGADO', async () => {
    app = await buildWithSession(makeUsuario(), {
      lockActiveEncargados: async () => [TARGET_ID],
    });

    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: { rol: 'deposito' },
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('LAST_ACTIVE_ENCARGADO');
  });

  it('returns 404 USER_NOT_FOUND for an id that matches no row', async () => {
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
    expect(response.json().error.code).toBe('USER_NOT_FOUND');
  });
});

describe('POST /api/usuarios/:id/deactivate and /reactivate', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const deactivateUrl = `/api/usuarios/${TARGET_ID}/deactivate`;
  const reactivateUrl = `/api/usuarios/${TARGET_ID}/reactivate`;

  it('returns 401 UNAUTHORIZED without a session on both routes', async () => {
    app = await buildWithSession(undefined);

    for (const url of [deactivateUrl, reactivateUrl]) {
      const response = await app.inject({ method: 'POST', url });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    }
  });

  it('returns 403 FORBIDDEN for a deposito session on both routes', async () => {
    app = await buildWithSession(makeUsuario({ rol: 'deposito' }));
    const cookies = { sid: app.signCookie('valid-token') };

    for (const url of [deactivateUrl, reactivateUrl]) {
      const response = await app.inject({ method: 'POST', url, cookies });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    }
  });

  it('deactivates and returns the updated usuario', async () => {
    app = await buildWithSession(makeUsuario(), {
      lockActiveEncargados: async () => [TARGET_ID, 'another-encargado-id'],
      setActivo: async () => makeResumen({ activo: false }),
    });

    const response = await app.inject({
      method: 'POST',
      url: deactivateUrl,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().usuario.activo).toBe(false);
  });

  it('reactivates and returns the updated usuario', async () => {
    app = await buildWithSession(makeUsuario(), {
      findByIdForUpdate: async () => makeResumen({ activo: false }),
      setActivo: async () => makeResumen({ activo: true }),
    });

    const response = await app.inject({
      method: 'POST',
      url: reactivateUrl,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().usuario.activo).toBe(true);
  });

  it('refuses to deactivate the last active encargado with 409', async () => {
    app = await buildWithSession(makeUsuario(), {
      lockActiveEncargados: async () => [TARGET_ID],
    });

    const response = await app.inject({
      method: 'POST',
      url: deactivateUrl,
      cookies: { sid: app.signCookie('valid-token') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('LAST_ACTIVE_ENCARGADO');
  });

  it('returns 404 USER_NOT_FOUND on both routes for an unknown id', async () => {
    app = await buildWithSession(makeUsuario(), {
      findByIdForUpdate: async () => undefined,
      lockActiveEncargados: async () => ['someone-else'],
    });
    const cookies = { sid: app.signCookie('valid-token') };

    for (const url of [deactivateUrl, reactivateUrl]) {
      const response = await app.inject({ method: 'POST', url, cookies });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('USER_NOT_FOUND');
    }
  });

  it('never returns a temporary password from either route', async () => {
    app = await buildWithSession(makeUsuario(), {
      lockActiveEncargados: async () => [TARGET_ID, 'another-encargado-id'],
    });
    const cookies = { sid: app.signCookie('valid-token') };

    for (const url of [deactivateUrl, reactivateUrl]) {
      const response = await app.inject({ method: 'POST', url, cookies });
      expect(response.body).not.toContain('passwordTemporal');
    }
  });
});
