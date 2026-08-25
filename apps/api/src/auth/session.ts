import { randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';

// The session cookie value IS the sesiones.id primary key (design.md D4).
export const SESSION_COOKIE = 'sid';

const SESSION_TTL_SECONDS = 43200; // 12h, fixed (design.md D15, no sliding renewal)

export function createToken(): string {
  return randomBytes(32).toString('base64url');
}

// design.md "Key Config Shapes" — sessionCookieOptions(). Attributes are set
// explicitly here rather than relying on the plugin's global parseOptions so
// this stays the single source of truth for the ADR-0010 "no domain" rule.
export function sessionCookieOptions(): CookieSerializeOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_SECONDS,
  };
}
