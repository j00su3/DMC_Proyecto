import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';
import { authLayout } from './authLayout.js';

/**
 * `beforeLoad` is called directly with a stub `{ queryClient }` context —
 * the highest-value logic without spinning up a full router (design.md
 * Testing Strategy).
 */
// biome-ignore lint/style/noNonNullAssertion: beforeLoad is always set on this route
const beforeLoad = authLayout.options.beforeLoad!;

describe('authLayout beforeLoad', () => {
  it('redirects to /ingresar when the session resolves to null', async () => {
    const queryClient = { ensureQueryData: vi.fn().mockResolvedValue(null) };

    const error = await beforeLoad({ context: { queryClient } } as never).catch(
      (e: unknown) => e,
    );

    expect(isRedirect(error)).toBe(true);
    expect((error as { options: { to: string } }).options.to).toBe('/ingresar');
  });

  it('passes through and exposes usuario when the session resolves', async () => {
    const usuario = {
      id: '1',
      nombre: 'Ana',
      email: 'ana@test.com',
      rol: 'encargado' as const,
      debeCambiarPassword: false,
    };
    const queryClient = { ensureQueryData: vi.fn().mockResolvedValue(usuario) };

    const result = await beforeLoad({ context: { queryClient } } as never);

    expect(result).toEqual({ usuario });
  });
});
