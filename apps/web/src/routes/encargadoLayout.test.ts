import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { encargadoLayout } from './encargadoLayout.js';
import { shellLayout } from './shellLayout.js';

// biome-ignore lint/style/noNonNullAssertion: beforeLoad is always set on this route
const beforeLoad = encargadoLayout.options.beforeLoad!;

/**
 * This guard is UX convenience only, exactly like `shellLayout`'s
 * forced-change guard: it spares a `deposito` session a dead-end screen. It
 * is NOT the enforcement mechanism — the backend returns `403 FORBIDDEN` on
 * every user-management route regardless of what this guard does, and that
 * is the actual security boundary.
 */
describe('encargadoLayout beforeLoad (UX convenience only, not access control)', () => {
  it('redirects to / when the session usuario is not an encargado', () => {
    const context = { usuario: { rol: 'deposito' as const } };

    let error: unknown;
    try {
      beforeLoad({ context } as never);
    } catch (e) {
      error = e;
    }

    expect(isRedirect(error)).toBe(true);
    expect((error as { options: { to: string } }).options.to).toBe('/');
  });

  it('passes through when the session usuario is an encargado', () => {
    const context = { usuario: { rol: 'encargado' as const } };

    expect(beforeLoad({ context } as never)).toBeUndefined();
  });

  it('is nested under shellLayout (client order mirrors the server: session -> forced-change -> role)', () => {
    expect(encargadoLayout.options.getParentRoute?.()).toBe(shellLayout);
  });
});
