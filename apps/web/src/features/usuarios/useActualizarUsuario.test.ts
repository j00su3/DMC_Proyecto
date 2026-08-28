import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usuariosKeys } from './queries.js';
import { useActualizarUsuario } from './useActualizarUsuario.js';

function buildWrapper(sessionId: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (sessionId) {
    queryClient.setQueryData(['session'], { id: sessionId });
  }
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  }
  return { Wrapper, queryClient, invalidateSpy, setQueryDataSpy };
}

function stubFetchOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        usuario: {
          id: '7',
          nombre: 'Cambiado',
          email: 'c@test.com',
          rol: 'deposito',
          activo: true,
          debeCambiarPassword: false,
          creadoEn: '2026-01-01T12:00:00.000Z',
        },
      }),
    }),
  );
}

/**
 * P3 (design.md Testing Strategy) — D18's dirty-fields PATCH and D10's
 * invalidation map, including the non-obvious `['session']` entry when the
 * PATCH target is the logged-in user. D9 spy: no usuarios mutation ever
 * calls `setQueryData`.
 */
describe('useActualizarUsuario', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends exactly the given partial body as the PATCH request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        usuario: {
          id: '7',
          nombre: 'Cambiado',
          email: 'c@test.com',
          rol: 'deposito',
          activo: true,
          debeCambiarPassword: false,
          creadoEn: '2026-01-01T12:00:00.000Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { Wrapper } = buildWrapper('1');

    const { result } = renderHook(() => useActualizarUsuario('7'), {
      wrapper: Wrapper,
    });

    result.current.mutate({ nombre: 'Cambiado' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const call = fetchMock.mock.calls[0];
    expect(call?.[1]?.body).toBe(JSON.stringify({ nombre: 'Cambiado' }));
  });

  it('invalidates lists(), detail(id) AND session when the target is the logged-in user (D10)', async () => {
    stubFetchOk();
    const { Wrapper, invalidateSpy, setQueryDataSpy } = buildWrapper('7');

    const { result } = renderHook(() => useActualizarUsuario('7'), {
      wrapper: Wrapper,
    });

    result.current.mutate({ nombre: 'Cambiado' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(usuariosKeys.lists());
    expect(invalidatedKeys).toContainEqual(usuariosKeys.detail('7'));
    expect(invalidatedKeys).toContainEqual(['session']);
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });

  it('does NOT invalidate session when PATCH targets another user (D10)', async () => {
    stubFetchOk();
    const { Wrapper, invalidateSpy, setQueryDataSpy } = buildWrapper('1');

    const { result } = renderHook(() => useActualizarUsuario('7'), {
      wrapper: Wrapper,
    });

    result.current.mutate({ nombre: 'Cambiado' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(usuariosKeys.lists());
    expect(invalidatedKeys).toContainEqual(usuariosKeys.detail('7'));
    expect(invalidatedKeys).not.toContainEqual(['session']);
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });
});
