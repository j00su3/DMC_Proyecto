import { describe, expect, it } from 'vitest';
import { resolveSessionRateLimitKey } from './sessionRateLimit.js';

const IP = '10.0.0.1';

describe('resolveSessionRateLimitKey', () => {
  // The security property (SECURITY-REPORT.md S02/S12): IP is not a safe
  // rate-limit key on these routes, because real-IP resolution is only
  // partially verifiable. A resolved session buckets by the authenticated
  // user instead, so two sessions behind the same address (or the same
  // session behind two spoofed addresses) still land in separate/shared
  // buckets correctly.
  it('uses the session user id when a user is present', () => {
    expect(resolveSessionRateLimitKey({ id: 'u1' }, IP)).toBe('u1');
  });

  it('keys two different users separately even from the same IP', () => {
    const first = resolveSessionRateLimitKey({ id: 'u1' }, IP);
    const second = resolveSessionRateLimitKey({ id: 'u2' }, IP);
    expect(first).not.toBe(second);
  });

  // Defensive fallback only: these routes require a resolved session before
  // the rate-limit hook ever runs (auth.ts's onRequest hook is registered
  // first and throws 401 on any missing/invalid session, short-circuiting
  // later onRequest hooks). A null user should never reach this in
  // production, but the function must not throw if it ever does.
  it('falls back to the IP when no user is present', () => {
    expect(resolveSessionRateLimitKey(null, IP)).toBe(IP);
  });
});
