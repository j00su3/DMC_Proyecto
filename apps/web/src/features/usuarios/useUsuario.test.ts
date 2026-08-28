import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isApiError } from '../../api/errors.js';
import { usuariosKeys } from './queries.js';
import { useUsuario } from './useUsuario.js';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  }
  return { Wrapper, queryClient };
}

/**
 * P3 (design.md Testing Strategy) — detail query keyed by `usuariosKeys.detail(id)`
 * (D7). Error mapping to copy is `errorMessages.ts`'s job (used by the route);
 * this hook only needs to surface the typed `ApiError` untouched.
 */
describe('useUsuario', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queries usuariosKeys.detail(id) and caches the fetched user under that key', async () => {
    const usuario = {
      id: '7',
      nombre: 'Ana',
      email: 'ana@test.com',
      rol: 'encargado' as const,
      activo: true,
      debeCambiarPassword: false,
      creadoEn: '2026-01-01T12:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ usuario }),
      }),
    );
    const { Wrapper, queryClient } = buildWrapper();

    const { result } = renderHook(() => useUsuario('7'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ usuario }));
    expect(queryClient.getQueryData(usuariosKeys.detail('7'))).toEqual({
      usuario,
    });
  });

  it('surfaces a USER_NOT_FOUND ApiError untouched when the id does not exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: { code: 'USER_NOT_FOUND', message: 'not found' },
        }),
      }),
    );
    const { Wrapper } = buildWrapper();

    const { result } = renderHook(() => useUsuario('missing'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isApiError(result.current.error) && result.current.error.code).toBe(
      'USER_NOT_FOUND',
    );
  });
});
