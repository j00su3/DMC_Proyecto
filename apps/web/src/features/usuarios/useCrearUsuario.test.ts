import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../../routes/routeTree.js';
import { useCrearUsuario } from './useCrearUsuario.js';

const PLAINTEXT = 'Xk7-Tq2-Bm9-Zp4';

function stubFetchOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        usuario: {
          id: '9',
          nombre: 'Nuevo Usuario',
          email: 'nuevo@test.com',
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
  const history = createMemoryHistory({ initialEntries: ['/usuarios/nuevo'] });
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
 * P3 (design.md Testing Strategy) — the highest-value test in this change,
 * the client mirror of the archived `gestion-usuarios` server-side leak
 * test. D12's narrowing is structural, not disciplinary: the mutation's
 * `mutationFn` returns only `body.usuario`, so `mutation.data` is typed with
 * no `passwordTemporal` member and the credential can never enter the query
 * cache or the mutation cache. Five assertions sweep the entire constraint
 * mechanically rather than by review.
 */
describe('useCrearUsuario', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never lets the plaintext password reach the query cache, mutation cache, router state, or web storage', async () => {
    stubFetchOk();
    const { Wrapper, queryClient, router } = buildRouterAndWrapper();
    await router.load();

    const { result } = renderHook(() => useCrearUsuario(), {
      wrapper: Wrapper,
    });

    result.current.mutate({
      nombre: 'Nuevo Usuario',
      email: 'nuevo@test.com',
      rol: 'deposito',
    });

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
      nombre: 'Nuevo Usuario',
      passwordTemporal: PLAINTEXT,
    });
  });

  it('triangulates with a different plaintext: the containment holds for any credential value', async () => {
    const otherPassword = 'Mq3-Rn8-Vp2-Ct6';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          usuario: {
            id: '11',
            nombre: 'Otra Persona',
            email: 'otra@test.com',
            rol: 'encargado',
            activo: true,
            debeCambiarPassword: true,
            creadoEn: '2026-01-01T12:00:00.000Z',
          },
          passwordTemporal: otherPassword,
        }),
      }),
    );
    const { Wrapper, queryClient } = buildRouterAndWrapper();

    const { result } = renderHook(() => useCrearUsuario(), {
      wrapper: Wrapper,
    });

    result.current.mutate({
      nombre: 'Otra Persona',
      email: 'otra@test.com',
      rol: 'encargado',
    });

    await waitFor(() => expect(result.current.credential).not.toBeNull());

    expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain(
      otherPassword,
    );
    expect(
      JSON.stringify(queryClient.getMutationCache().getAll()),
    ).not.toContain(otherPassword);
    expect(result.current.credential).toEqual({
      nombre: 'Otra Persona',
      passwordTemporal: otherPassword,
    });
  });

  it('invalidates lists() on success and never calls setQueryData (D9)', async () => {
    stubFetchOk();
    const { Wrapper, invalidateSpy, setQueryDataSpy } = buildRouterAndWrapper();

    const { result } = renderHook(() => useCrearUsuario(), {
      wrapper: Wrapper,
    });

    result.current.mutate({
      nombre: 'Nuevo Usuario',
      email: 'nuevo@test.com',
      rol: 'deposito',
    });

    await waitFor(() => expect(result.current.credential).not.toBeNull());

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['usuarios', 'list'] }),
    );
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });

  it('acknowledge() clears the credential', async () => {
    stubFetchOk();
    const { Wrapper } = buildRouterAndWrapper();

    const { result } = renderHook(() => useCrearUsuario(), {
      wrapper: Wrapper,
    });

    result.current.mutate({
      nombre: 'Nuevo Usuario',
      email: 'nuevo@test.com',
      rol: 'deposito',
    });

    await waitFor(() => expect(result.current.credential).not.toBeNull());

    result.current.acknowledge();

    await waitFor(() => expect(result.current.credential).toBeNull());
  });
});
