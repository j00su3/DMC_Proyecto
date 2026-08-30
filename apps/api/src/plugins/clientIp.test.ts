import { describe, expect, it } from 'vitest';
import { PROXY_SECRET_HEADER, resolveRateLimitKey } from './clientIp.js';

const SOCKET = '10.0.0.1';
const SECRET = 'a-shared-secret-between-vercel-and-render';
const CLIENT = '203.0.113.7';

describe('resolveRateLimitKey', () => {
  // The security property. The Render origin is publicly reachable, so anyone
  // can send whatever X-Forwarded-For they like straight to it. Without the
  // shared secret that header buys them nothing: every forged value collapses
  // onto the same socket-derived key, so they get one bucket, not one per
  // invented address.
  it('ignores a forged X-Forwarded-For when the request carries no secret', () => {
    expect(
      resolveRateLimitKey({ 'x-forwarded-for': CLIENT }, SOCKET, SECRET),
    ).toBe(SOCKET);
  });

  it('ignores X-Forwarded-For when the presented secret is wrong', () => {
    expect(
      resolveRateLimitKey(
        { 'x-forwarded-for': CLIENT, [PROXY_SECRET_HEADER]: 'not-the-secret' },
        SOCKET,
        SECRET,
      ),
    ).toBe(SOCKET);
  });

  // A wrong secret of the SAME length must not pass either — the comparison is
  // timing-safe, not a length check.
  it('ignores a wrong secret that is the same length as the real one', () => {
    const sameLength = 'x'.repeat(SECRET.length);
    expect(sameLength).toHaveLength(SECRET.length);
    expect(
      resolveRateLimitKey(
        { 'x-forwarded-for': CLIENT, [PROXY_SECRET_HEADER]: sameLength },
        SOCKET,
        SECRET,
      ),
    ).toBe(SOCKET);
  });

  // The fail-safe. If the secret was never configured, the limit behaves
  // exactly as it does today rather than trusting anything new.
  it('falls back to the socket address when no secret is configured', () => {
    expect(
      resolveRateLimitKey(
        { 'x-forwarded-for': CLIENT, [PROXY_SECRET_HEADER]: SECRET },
        SOCKET,
        undefined,
      ),
    ).toBe(SOCKET);
  });

  it('uses the forwarded client only when the secret matches', () => {
    expect(
      resolveRateLimitKey(
        { 'x-forwarded-for': CLIENT, [PROXY_SECRET_HEADER]: SECRET },
        SOCKET,
        SECRET,
      ),
    ).toBe(CLIENT);
  });

  it('takes the leftmost entry of a multi-hop X-Forwarded-For', () => {
    expect(
      resolveRateLimitKey(
        {
          'x-forwarded-for': `${CLIENT}, 70.0.0.1, 70.0.0.2`,
          [PROXY_SECRET_HEADER]: SECRET,
        },
        SOCKET,
        SECRET,
      ),
    ).toBe(CLIENT);
  });

  it('falls back to the socket address when the secret matches but no forwarded header is present', () => {
    expect(
      resolveRateLimitKey({ [PROXY_SECRET_HEADER]: SECRET }, SOCKET, SECRET),
    ).toBe(SOCKET);
  });

  it('falls back to the socket address when the forwarded header is blank', () => {
    expect(
      resolveRateLimitKey(
        { 'x-forwarded-for': '   ', [PROXY_SECRET_HEADER]: SECRET },
        SOCKET,
        SECRET,
      ),
    ).toBe(SOCKET);
  });
});
