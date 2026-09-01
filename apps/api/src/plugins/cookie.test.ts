import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCookieSecret } from './cookie.js';

// SECURITY-REPORT.md S05: this guard used to hang off the identical
// `process.env.NODE_ENV === 'production'` comparison as session.ts's
// `secure` flag, and failed open the same way — a missing NODE_ENV never
// threw, so the versioned dev fallback secret was reachable by default. It
// now requires the same explicit ALLOW_INSECURE_COOKIES=true opt-out as the
// cookie's Secure flag.
describe('resolveCookieSecret', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('always prefers an explicit secret, regardless of env', () => {
    vi.stubEnv('COOKIE_SECRET', 'from-env-should-be-ignored');
    vi.stubEnv('ALLOW_INSECURE_COOKIES', undefined);

    expect(resolveCookieSecret('explicit-secret')).toBe('explicit-secret');
  });

  it('falls back to process.env.COOKIE_SECRET when no explicit secret is given', () => {
    vi.stubEnv('COOKIE_SECRET', 'from-env-secret');
    vi.stubEnv('ALLOW_INSECURE_COOKIES', undefined);

    expect(resolveCookieSecret()).toBe('from-env-secret');
  });

  it.each([
    ['production', 'production'],
    ['development', 'development'],
    ['unset', undefined],
  ])(
    'throws instead of falling back to the dev secret when NODE_ENV is %s and ALLOW_INSECURE_COOKIES is not set',
    (_label, nodeEnv) => {
      vi.stubEnv('COOKIE_SECRET', undefined);
      vi.stubEnv('ALLOW_INSECURE_COOKIES', undefined);
      vi.stubEnv('NODE_ENV', nodeEnv);

      expect(() => resolveCookieSecret()).toThrow(/COOKIE_SECRET/);
    },
  );

  it('rejects a non-exact ALLOW_INSECURE_COOKIES value the same as unset (deliberate opt-in, not a truthy check)', () => {
    vi.stubEnv('COOKIE_SECRET', undefined);
    vi.stubEnv('ALLOW_INSECURE_COOKIES', '1');

    expect(() => resolveCookieSecret()).toThrow(/COOKIE_SECRET/);
  });

  it('returns the dev fallback secret only with ALLOW_INSECURE_COOKIES=true set explicitly', () => {
    vi.stubEnv('COOKIE_SECRET', undefined);
    vi.stubEnv('ALLOW_INSECURE_COOKIES', 'true');

    expect(resolveCookieSecret()).toBe(
      'dev-only-cookie-secret-not-for-production-use!!',
    );
  });
});
