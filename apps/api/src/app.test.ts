import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import type { AuditoriaRepo } from './auditoria/repository.js';
import type { SesionesRepo } from './auth/repository.js';
import type { MovimientosRepo } from './movimientos/repository.js';
import type { ProductosRepo } from './productos/repository.js';
import type { ProveedoresRepo } from './proveedores/repository.js';
import type { UsuariosRepo } from './usuarios/repository.js';
import type { VentasRepo } from './ventas/repository.js';

/**
 * `app.log.level` is the observable difference: Fastify swaps in a no-op
 * logger when logging is disabled, and that object has no `level` at all.
 * A real pino instance reports the configured level.
 *
 * The environment is driven with `vi.stubEnv` rather than assigning
 * `process.env` by hand. Deleting a key needs `vi.stubEnv(key, undefined)`:
 * a plain `process.env.LOG_LEVEL = undefined` would store the *string*
 * "undefined", which is truthy and would silently defeat the `??` default.
 */
/**
 * `satisfies`, not `as`: it validates conformance instead of asserting it, so
 * a stub missing a member fails immediately and names the member, rather than
 * waiting until the two types stop overlapping "sufficiently".
 *
 * That was NOT what broke this file, though, and the distinction matters. It
 * reached main broken because it was written on a branch cut from main while
 * a nine-PR chain was still open; that chain widened `UsuariosRepo` and
 * `SesionesRepo` with `updatePassword`/`deleteOthers`. CI was green on both
 * sides because neither ever compiled the other's code. No annotation
 * prevents that — only typechecking the merged result does.
 */
function unusedRepoMethod(): never {
  throw new Error('app.test.ts fake: this repo method is outside this suite');
}

function fakeRepos(sesionesOverrides: Partial<SesionesRepo> = {}) {
  return {
    usuarios: {
      findByEmail: async () => undefined,
      registerFailedAttempt: async () => ({
        intentosFallidos: 1,
        bloqueadoHasta: null,
      }),
      resetAttempts: async () => {},
      updatePassword: async () => {},
      // These tests exercise logging and wiring, never user management, so
      // the CRUD half of the port throws instead of returning a plausible
      // row: a stub that answers is a stub a future test can pass against
      // by accident. `satisfies` is what forced them to be added at all —
      // it is deliberately not `as` (see the auth suites, which use `as`
      // and would have silently accepted the narrower fake).
      list: unusedRepoMethod,
      findById: unusedRepoMethod,
      findByIdForUpdate: unusedRepoMethod,
      lockActiveEncargados: unusedRepoMethod,
      findLockoutState: unusedRepoMethod,
      create: unusedRepoMethod,
      update: unusedRepoMethod,
      setActivo: unusedRepoMethod,
      resetPassword: unusedRepoMethod,
    } satisfies UsuariosRepo,
    sesiones: {
      create: async () => {},
      findValid: async () => undefined,
      delete: async () => {},
      purgeExpired: async () => {},
      deleteOthers: async () => {},
      deleteAllForUser: unusedRepoMethod,
      ...sesionesOverrides,
    } satisfies SesionesRepo,
    auditoria: {
      record: async () => {},
    } satisfies AuditoriaRepo,
    // These tests exercise logging and wiring, never supplier management
    // (same reasoning as the usuarios stub above).
    proveedores: {
      list: unusedRepoMethod,
      findById: unusedRepoMethod,
      findByIdForUpdate: unusedRepoMethod,
      create: unusedRepoMethod,
      update: unusedRepoMethod,
      setActivo: unusedRepoMethod,
    } satisfies ProveedoresRepo,
    // These tests exercise logging and wiring, never product/ledger
    // management (same reasoning as the proveedores stub above).
    productos: {
      list: unusedRepoMethod,
      findById: unusedRepoMethod,
      findByIdForUpdate: unusedRepoMethod,
      create: unusedRepoMethod,
      update: unusedRepoMethod,
      setActivo: unusedRepoMethod,
      aplicarDelta: unusedRepoMethod,
      revertirStockPorAnulacion: unusedRepoMethod,
    } satisfies ProductosRepo,
    movimientos: {
      create: unusedRepoMethod,
      listByProducto: unusedRepoMethod,
    } satisfies MovimientosRepo,
    ventas: {
      create: unusedRepoMethod,
      createItems: unusedRepoMethod,
      createPagos: unusedRepoMethod,
      findById: unusedRepoMethod,
      findByNumeroCorrelativo: unusedRepoMethod,
      findItems: unusedRepoMethod,
      findPagos: unusedRepoMethod,
      marcarAnulada: unusedRepoMethod,
      revertirPagos: unusedRepoMethod,
    } satisfies VentasRepo,
  };
}

const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const fakeDb = { checkDb: async () => true };

describe('buildApp logging', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.unstubAllEnvs();
  });

  async function build(logger?: false) {
    return buildApp({
      repos: fakeRepos(),
      cookieSecret: COOKIE_SECRET,
      db: fakeDb,
      ...(logger === undefined ? {} : { logger }),
    });
  }

  it('stays silent outside production so tests and local runs are not noisy', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    app = await build();

    expect(app.log.level).toBeUndefined();
  });

  it('logs at info in production, so a failed boot leaves a diagnostic', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', undefined);
    app = await build();

    expect(app.log.level).toBe('info');
  });

  it('honours LOG_LEVEL in production without a redeploy', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', 'warn');
    app = await build();

    expect(app.log.level).toBe('warn');
  });

  it('lets an explicit option override the environment entirely', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    app = await build(false);

    expect(app.log.level).toBeUndefined();
  });
});

// SECURITY-REPORT.md S03: no HTTP security headers were emitted anywhere.
describe('buildApp security headers', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('emits a strict CSP, nosniff and a same-origin referrer policy on every response', async () => {
    app = await buildApp({
      repos: fakeRepos(),
      cookieSecret: COOKIE_SECRET,
      db: fakeDb,
    });

    // /api/health is unauthenticated (config: { auth: false }) and simplest
    // to exercise here — headers come from a hook registered ahead of every
    // route plugin, so this is not testing health-route-specific behaviour.
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('same-origin');
  });
});

// SECURITY-REPORT.md S04: authenticated responses carried no Cache-Control,
// letting an intermediate cache serve a prior user's identity or directory.
describe('buildApp Cache-Control on authenticated responses', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('sets no-store on an authenticated GET route, and leaves /api/health unset', async () => {
    const repos = fakeRepos({
      findValid: async () => ({
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
      }),
    });
    app = await buildApp({ repos, cookieSecret: COOKIE_SECRET, db: fakeDb });
    const cookies = { sid: app.signCookie('valid-token') };

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies,
    });
    expect(me.headers['cache-control']).toBe('no-store');

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.headers['cache-control']).toBeUndefined();
  });
});
