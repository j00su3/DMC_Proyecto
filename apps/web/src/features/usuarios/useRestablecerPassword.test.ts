import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../../routes/routeTree.js';
import { usuariosKeys } from './queries.js';
import { useRestablecerPassword } from './useRestablecerPassword.js';

const PLAINTEXT = 'Rk9-Wq3-Bn7-Yp1';

function stubFetchOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        usuario: {
          id: '7',
          nombre: 'Beto',
          email: 'beto@test.com',
          rol: 'deposito',
          activo: true,
          debeCambiarPassword: true,
          creadoEn: '2026-01-01T12:00:00.000Z',
        },
        passwordTemporal: PLAINTEXT,
      }),
    }),
  );
}

function buildRouterAndWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
  const history = createMemoryHistory({ initialEntries: ['/usuarios/7'] });
  const router = createRouter({ routeTree, context: { queryClient }, history });

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  }

  return { Wrapper, queryClient, router, invalidateSpy, setQueryDataSpy };
}

/**
 * P3 (design.md Testing Strategy) — the containment sweep repeated for
 * password-reset (D12): the pattern that protects create must protect reset,
 * not just be assumed for it. Mirrors `useCrearUsuario.test.ts` exactly.
 * Sends a bodyless `POST /usuarios/:id/password-reset` per the "Two
 * corrections" note.
 */
describe('useRestablecerPassword', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a bodyless POST to /usuarios/:id/password-reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        usuario: {
          id: '7',
          nombre: 'Beto',
          email: 'beto@test.com',
          rol: 'deposito',
          activo: true,
          debeCambiarPassword: true,
          creadoEn: '2026-01-01T12:00:00.000Z',
        },
        passwordTemporal: PLAINTEXT,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { Wrapper } = buildRouterAndWrapper();

    const { result } = renderHook(() => useRestablecerPassword(), {
      wrapper: Wrapper,
    });

    result.current.mutate('7');

    await waitFor(() => expect(result.current.credential).not.toBeNull());

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/usuarios/7/password-reset');
    expect(call?.[1]?.method).toBe('POST');
    expect(call?.[1]?.body).toBeUndefined();
  });

  it('never lets the plaintext password reach the query cache, mutation cache, router state, or web storage', async () => {
    stubFetchOk();
    const { Wrapper, queryClient, router } = buildRouterAndWrapper();
    await router.load();

    const { result } = renderHook(() => useRestablecerPassword(), {
      wrapper: Wrapper,
    });

    result.current.mutate('7');

    await waitFor(() => expect(result.current.credential).not.toBeNull());

    expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain(
      PLAINTEXT,
    );
    expect(
      JSON.stringify(queryClient.getMutationCache().getAll()),
    ).not.toContain(PLAINTEXT);
    expect(router.state.location.href).not.toContain(PLAINTEXT);
    expect(JSON.stringify(localStorage)).not.toContain(PLAINTEXT);
    expect(JSON.stringify(sessionStorage)).not.toContain(PLAINTEXT);

    expect(result.current.credential).toEqual({
      nombre: 'Beto',
      passwordTemporal: PLAINTEXT,
    });
  });

  it('triangulates with a different plaintext: the containment holds for any credential value', async () => {
    const otherPassword = 'Zt4-Ln6-Qh8-Xr2';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          usuario: {
            id: '7',
            nombre: 'Beto',
            email: 'beto@test.com',
            rol: 'deposito',
            activo: true,
            debeCambiarPassword: true,
            creadoEn: '2026-01-01T12:00:00.000Z',
          },
          passwordTemporal: otherPassword,
        }),
      }),
    );
    const { Wrapper, queryClient } = buildRouterAndWrapper();

    const { result } = renderHook(() => useRestablecerPassword(), {
      wrapper: Wrapper,
    });

    result.current.mutate('7');

    await waitFor(() => expect(result.current.credential).not.toBeNull());

    expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain(
      otherPassword,
    );
    expect(
      JSON.stringify(queryClient.getMutationCache().getAll()),
    ).not.toContain(otherPassword);
    expect(result.current.credential).toEqual({
      nombre: 'Beto',
      passwordTemporal: otherPassword,
    });
  });

  it('invalidates lists() and detail(id) on success and never calls setQueryData (D9)', async () => {
    stubFetchOk();
    const { Wrapper, invalidateSpy, setQueryDataSpy } = buildRouterAndWrapper();

    const { result } = renderHook(() => useRestablecerPassword(), {
      wrapper: Wrapper,
    });

    result.current.mutate('7');

    await waitFor(() => expect(result.current.credential).not.toBeNull());

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(usuariosKeys.lists());
    expect(invalidatedKeys).toContainEqual(usuariosKeys.detail('7'));
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });

  it('acknowledge() clears the credential', async () => {
    stubFetchOk();
    const { Wrapper } = buildRouterAndWrapper();

    const { result } = renderHook(() => useRestablecerPassword(), {
      wrapper: Wrapper,
    });

    result.current.mutate('7');

    await waitFor(() => expect(result.current.credential).not.toBeNull());

    result.current.acknowledge();

    await waitFor(() => expect(result.current.credential).toBeNull());
  });
});
