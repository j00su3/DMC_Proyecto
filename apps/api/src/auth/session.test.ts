import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_COOKIE,
  createToken,
  sessionCookieOptions,
} from './session.js';

describe('createToken', () => {
  it('produces a base64url token decoding to 32 raw bytes', () => {
    const token = createToken();

    // base64url alphabet only — no '+', '/' or '=' padding characters.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url').length).toBe(32);
  });

  it('produces a different token on every call (entropy, not a constant)', () => {
    const first = createToken();
    const second = createToken();

    expect(first).not.toBe(second);
  });
});

describe('sessionCookieOptions', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.unstubAllEnvs();
  });

  it('never includes a domain key, in any environment (ADR-0010 guard)', () => {
    process.env.NODE_ENV = 'production';
    expect(sessionCookieOptions()).not.toHaveProperty('domain');

    process.env.NODE_ENV = 'development';
    expect(sessionCookieOptions()).not.toHaveProperty('domain');
  });

  // SECURITY-REPORT.md S05: `secure` used to fail open to `false` whenever
  // NODE_ENV was not exactly 'production', including unset. It now defaults
  // to `true` unconditionally — NODE_ENV plays no part any more — and only
  // an explicit ALLOW_INSECURE_COOKIES=true opt-out turns it off.
  it('defaults secure=true regardless of NODE_ENV, including unset', () => {
    vi.stubEnv('ALLOW_INSECURE_COOKIES', undefined);

    process.env.NODE_ENV = 'production';
    expect(sessionCookieOptions().secure).toBe(true);

    process.env.NODE_ENV = 'development';
    expect(sessionCookieOptions().secure).toBe(true);

    vi.stubEnv('NODE_ENV', undefined);
    expect(sessionCookieOptions().secure).toBe(true);

    vi.unstubAllEnvs();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('sets secure=false only when ALLOW_INSECURE_COOKIES=true is set explicitly', () => {
    process.env.NODE_ENV = 'development';
    vi.stubEnv('ALLOW_INSECURE_COOKIES', 'true');
    expect(sessionCookieOptions().secure).toBe(false);

    // Anything other than the exact string 'true' stays secure — this is a
    // deliberate opt-in, not a generic truthy check.
    vi.stubEnv('ALLOW_INSECURE_COOKIES', '1');
    expect(sessionCookieOptions().secure).toBe(true);

    vi.unstubAllEnvs();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('matches the fixed 12h session shape from design.md', () => {
    process.env.NODE_ENV = 'development';
    const options = sessionCookieOptions();

    expect(options.path).toBe('/');
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.signed).toBe(true);
    expect(options.maxAge).toBe(43200);
  });
});

describe('SESSION_COOKIE', () => {
  it('is the fixed cookie name used across the auth seam', () => {
    expect(SESSION_COOKIE).toBe('sid');
  });
});
