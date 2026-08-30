import { next, rewrite } from '@vercel/edge';

/**
 * Vercel Edge Middleware — SEC-003.
 *
 * The API's rate limit needs to know which client a request came from, but the
 * Render origin answers publicly (`GET
 * https://inventienda-api.onrender.com/api/health` → 200 without going through
 * Vercel), so `X-Forwarded-For` is a value any caller can invent. The API
 * therefore trusts it only when the request also carries this shared secret,
 * which a direct caller does not have — see `apps/api/src/plugins/clientIp.ts`.
 *
 * This file exists because a `vercel.json` rewrite cannot add a REQUEST
 * header: `headers` there configures responses, and `rewrites` has no header
 * field. Middleware is the only place in this deployment that can.
 *
 * Both failure directions degrade instead of breaking:
 *
 * - No secret configured, or anything here throws, and we fall through to the
 *   `/api/:path*` rewrite still present in `vercel.json`. The app keeps
 *   working; the rate limit simply keeps grouping everyone under the proxy's
 *   address, exactly as it did before this file existed.
 * - The header arrives without the secret and the API ignores it.
 *
 * The `vercel.json` rewrite is deliberately KEPT rather than replaced. If this
 * middleware ever fails to load, `/api/*` would otherwise fall through to the
 * SPA catch-all — which excludes `/api/` — and 404. Keeping both makes a
 * middleware failure a degradation rather than an outage.
 */
export const config = { matcher: '/api/:path*' };

const API_ORIGIN = 'https://inventienda-api.onrender.com';
const PROXY_SECRET_HEADER = 'x-inventienda-proxy';

export default function middleware(request: Request) {
  try {
    const secret = process.env.PROXY_SHARED_SECRET;
    if (!secret) {
      // Nothing to prove to the API. Let vercel.json's rewrite handle it.
      return next();
    }

    // `request.headers` REPLACES the upstream request's headers wholesale, so
    // it has to start from the incoming ones. Passing only the secret would
    // strip everything else — the session cookie included — and break
    // authentication for every request. `ExtraResponseInit.headers` is the
    // wrong field for this: those go on the response to the user and never
    // reach the API at all.
    const forwarded = new Headers(request.headers);
    forwarded.set(PROXY_SECRET_HEADER, secret);

    const url = new URL(request.url);
    return rewrite(`${API_ORIGIN}${url.pathname}${url.search}`, {
      request: { headers: forwarded },
    });
  } catch {
    // Never let this file be the reason the API is unreachable.
    return next();
  }
}
