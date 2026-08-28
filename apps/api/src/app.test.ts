import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import type { AuditoriaRepo } from './auditoria/repository.js';
import type { SesionesRepo } from './auth/repository.js';
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
    } satisfies UsuariosRepo,
    sesiones: {
      create: async () => {},
      findValid: async () => undefined,
      delete: async () => {},
      purgeExpired: async () => {},
      deleteOthers: async () => {},
    } satisfies SesionesRepo,
    auditoria: {
      record: async () => {},
    } satisfies AuditoriaRepo,
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
