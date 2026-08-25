import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// Fixed local-dev fallback only — never used in production (resolveSecret
// hard-throws instead). Not a real secret, so it is safe to commit.
const DEV_FALLBACK_SECRET = 'dev-only-cookie-secret-not-for-production-use!!';

// Secret resolution order (design.md D13): explicit option first, then
// process.env.COOKIE_SECRET, then the dev fallback — never NODE_ENV
// production. Importing lib/env.ts here would require DATABASE_URL at
// import time, dragging Postgres env into the unit suite and openapi
// generation (D13).
export function resolveCookieSecret(explicit?: string): string {
  if (explicit) {
    return explicit;
  }

  const fromEnv = process.env.COOKIE_SECRET;
  if (fromEnv) {
    return fromEnv;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'COOKIE_SECRET must be set in production (missing signing secret)',
    );
  }

  return DEV_FALLBACK_SECRET;
}

export interface CookiePluginOptions {
  secret?: string;
}

export default fp(async function cookiePlugin(
  app: FastifyInstance,
  opts: CookiePluginOptions,
) {
  await app.register(cookie, {
    secret: resolveCookieSecret(opts.secret),
    hook: 'onRequest',
    parseOptions: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    },
  });
});
