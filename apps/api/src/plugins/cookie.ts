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
//
// SECURITY-REPORT.md S05: this guard used to hang off the identical
// `process.env.NODE_ENV === 'production'` comparison as session.ts's
// `secure` flag, and failed open the same way — a missing NODE_ENV never
// throws, so the fallback secret (a constant committed in plaintext) was
// reachable by default rather than by explicit choice. It now requires the
// same opt-in escape hatch as the cookie's `Secure` flag,
// `ALLOW_INSECURE_COOKIES=true`, so a deployment has to ask for the insecure
// fallback rather than fall into it.
export function resolveCookieSecret(explicit?: string): string {
  if (explicit) {
    return explicit;
  }

  const fromEnv = process.env.COOKIE_SECRET;
  if (fromEnv) {
    return fromEnv;
  }

  if (process.env.ALLOW_INSECURE_COOKIES !== 'true') {
    throw new Error(
      'COOKIE_SECRET must be set (or ALLOW_INSECURE_COOKIES=true set explicitly to allow the dev fallback secret)',
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
