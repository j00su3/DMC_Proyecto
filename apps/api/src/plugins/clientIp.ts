import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * Header Vercel's proxy must present to prove a request really came through
 * it. Any name works; what matters is the secret it carries.
 */
export const PROXY_SECRET_HEADER = 'x-inventienda-proxy';

function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which would itself leak the
  // expected length through the error path.
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Rate-limit key for a request (SEC-003).
 *
 * The Render origin is publicly reachable — `GET
 * https://inventienda-api.onrender.com/api/health` answers 200 without going
 * through Vercel — so `X-Forwarded-For` is a value an attacker controls. That
 * is why `trustProxy` stays OFF: turning it on would make the forged header
 * the rate-limit key, and since SEC-001's fix left this rate limit as the only
 * brake on password guessing, a spoofable key is worse than the shared bucket
 * it replaces.
 *
 * So the header is trusted only when the request also carries the shared
 * secret, which a direct caller does not have. Every other case — no secret
 * configured, header absent, header wrong, no `X-Forwarded-For` — falls back
 * to the socket address, which is exactly today's behaviour.
 *
 * That fallback is the point: the change cannot take the site down. If the
 * secret is never configured, or Vercel stops sending it, the limit keeps
 * working the way it does now instead of rejecting traffic.
 */
export function resolveRateLimitKey(
  headers: IncomingHttpHeaders,
  socketIp: string,
  proxySecret: string | undefined,
): string {
  if (!proxySecret) {
    return socketIp;
  }

  const presented = headers[PROXY_SECRET_HEADER];
  if (typeof presented !== 'string' || !secretMatches(presented, proxySecret)) {
    return socketIp;
  }

  const forwarded = headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (!raw) {
    return socketIp;
  }

  // Leftmost entry is the original client; the rest are proxies that appended
  // themselves on the way in.
  const client = raw.split(',')[0]?.trim();
  return client && client.length > 0 ? client : socketIp;
}
