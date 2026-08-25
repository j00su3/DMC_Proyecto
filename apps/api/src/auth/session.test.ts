import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  });

  it('never includes a domain key, in any environment (ADR-0010 guard)', () => {
    process.env.NODE_ENV = 'production';
    expect(sessionCookieOptions()).not.toHaveProperty('domain');

    process.env.NODE_ENV = 'development';
    expect(sessionCookieOptions()).not.toHaveProperty('domain');
  });

  it('sets secure=true only when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';
    expect(sessionCookieOptions().secure).toBe(true);

    process.env.NODE_ENV = 'development';
    expect(sessionCookieOptions().secure).toBe(false);
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
