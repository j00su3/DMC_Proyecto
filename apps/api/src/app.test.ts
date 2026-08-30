import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import type { AuditoriaRepo } from './auditoria/repository.js';
import type { SesionesRepo } from './auth/repository.js';
import type { MovimientosRepo } from './movimientos/repository.js';
import type { ProductosRepo } from './productos/repository.js';
import type { ProveedoresRepo } from './proveedores/repository.js';
import type { UsuariosRepo } from './usuarios/repository.js';

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

function fakeRepos() {
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
    } satisfies ProductosRepo,
    movimientos: {
      create: unusedRepoMethod,
      listByProducto: unusedRepoMethod,
    } satisfies MovimientosRepo,
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
