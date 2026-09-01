/**
 * Rate-limit key for the argon2-heavy routes reachable only by an existing
 * session (SECURITY-REPORT.md S02): POST /auth/password, POST /usuarios and
 * POST /usuarios/:id/password-reset.
 *
 * IP is deliberately NOT used here, unlike `clientIp.ts`'s
 * `resolveRateLimitKey` for the unauthenticated `/auth/login`: SEC-003 /
 * S12 leave real-IP resolution only partially verifiable behind the Render
 * + Vercel proxy chain, and a spoofable key would be worse than none. These
 * three routes always carry a resolved session by the time this runs — the
 * RBAC `onRequest` hook in `plugins/auth.ts` is registered first and throws
 * 401 on any missing/invalid session, which short-circuits Fastify's
 * `onRequest` chain before `@fastify/rate-limit`'s own hook (and therefore
 * this `keyGenerator`) ever fires — so keying by the authenticated user id
 * is both safe and precise.
 *
 * The `ip` fallback is defensive only, for a null user this function should
 * never actually observe in production; it exists so a future caller that
 * does not carry that guarantee degrades instead of crashing.
 */
export function resolveSessionRateLimitKey(
  user: { id: string } | null,
  ip: string,
): string {
  return user?.id ?? ip;
}
