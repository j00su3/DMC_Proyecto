import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { shellLayout } from './shellLayout.js';

const baseUsuario = {
  id: '1',
  nombre: 'Ana',
  email: 'ana@test.com',
  rol: 'encargado' as const,
};

// biome-ignore lint/style/noNonNullAssertion: beforeLoad is always set on this route
const beforeLoad = shellLayout.options.beforeLoad!;

/**
 * This guard is UX convenience only: it spares a forced-change user an
 * extra bounce through a screen they cannot use. It is NOT the enforcement
 * mechanism — that authority is the server allowlist shipped in Phase 3
 * (D2–D4), which the API enforces regardless of what the SPA router does.
 */
describe('shellLayout beforeLoad (UX convenience only, not enforcement)', () => {
  it('redirects to /cambiar-password when the session usuario must change it', () => {
    const context = { usuario: { ...baseUsuario, debeCambiarPassword: true } };

    let error: unknown;
    try {
      beforeLoad({ context } as never);
    } catch (e) {
      error = e;
    }

    expect(isRedirect(error)).toBe(true);
    expect((error as { options: { to: string } }).options.to).toBe(
      '/cambiar-password',
    );
  });

  it('passes through when the session usuario does not need to change it', () => {
    const context = { usuario: { ...baseUsuario, debeCambiarPassword: false } };

    expect(beforeLoad({ context } as never)).toBeUndefined();
  });
});
