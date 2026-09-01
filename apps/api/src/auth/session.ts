import { createHash, randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';

// The session cookie carries the plaintext token; `sesiones.id` holds its
// sha256 (SEC-008). Until 2026-08-30 the cookie value WAS the primary key
// (design.md D4) — see `hashToken` below for why that changed.
export const SESSION_COOKIE = 'sid';

// 12h, fixed (design.md D15, no sliding renewal).
export const SESSION_TTL_SECONDS = 43200;

export function createToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SEC-008 / ADR-0007 § Actualizado 2026-08-29. The cookie value used to BE the
 * `sesiones` primary key, so any read of that table handed over live, usable
 * credentials. What is stored is now `sha256(token)`; the plaintext exists only
 * in the browser's cookie.
 *
 * The 2026-08-24 justification for having no separate token — "there is no
 * second session secret to keep synchronised with the row" — survives intact,
 * because a hash is not a secret: there is nothing here to guard or rotate.
 *
 * No salt and no key-stretching, deliberately. The input is 32 bytes of
 * `randomBytes`, so there is no dictionary to precompute and nothing for a
 * work factor to slow down; argon2 belongs on passwords, which are guessable,
 * not on a value with 256 bits of entropy.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// design.md "Key Config Shapes" — sessionCookieOptions(). Attributes are set
// explicitly here rather than relying on the plugin's global parseOptions so
// this stays the single source of truth for the ADR-0010 "no domain" rule.
//
// SECURITY-REPORT.md S05: `secure: process.env.NODE_ENV === 'production'`
// failed OPEN — a missing, misspelled or platform-omitted NODE_ENV produced
// an insecure cookie silently, with nothing to opt into. `secure` now
// defaults to `true` unconditionally; only an explicit
// `ALLOW_INSECURE_COOKIES=true` disables it, so the unsafe state has to be
// requested on purpose rather than fallen into.
export function sessionCookieOptions(): CookieSerializeOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    secure: process.env.ALLOW_INSECURE_COOKIES !== 'true',
    maxAge: SESSION_TTL_SECONDS,
  };
}
