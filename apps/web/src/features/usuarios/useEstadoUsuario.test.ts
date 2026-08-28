import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usuariosKeys } from './queries.js';
import { useEstadoUsuario } from './useEstadoUsuario.js';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  }
  return { Wrapper, invalidateSpy, setQueryDataSpy };
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
          nombre: 'Beto',
          email: 'beto@test.com',
          rol: 'deposito',
          activo: false,
          debeCambiarPassword: false,
          creadoEn: '2026-01-01T12:00:00.000Z',
        },
      }),
    }),
  );
}

function stubFetch409LastActiveEncargado() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: {
          code: 'LAST_ACTIVE_ENCARGADO',
          message: 'No se puede desactivar: es el último encargado activo.',
        },
      }),
    }),
  );
}

/**
 * P3 (design.md Testing Strategy) — D9/D10's invalidation map for deactivate
 * and reactivate. "Two corrections" note in tasks.md: `apiFetch` is called
 * with NO `body` key at all (the merged `apiFetch` fix already gates
 * `Content-Type` on `init.body !== undefined`), not the design doc's
 * original `JSON.stringify({})` hedge.
 */
describe('useEstadoUsuario', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deactivate sends a bodyless POST to /usuarios/:id/deactivate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        usuario: {
          id: '7',
          nombre: 'Beto',
          email: 'beto@test.com',
          rol: 'deposito',
          activo: false,
          debeCambiarPassword: false,
          creadoEn: '2026-01-01T12:00:00.000Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { Wrapper } = buildWrapper();

    const { result } = renderHook(() => useEstadoUsuario(), {
      wrapper: Wrapper,
    });

    result.current.deactivate.mutate('7');

    await waitFor(() => expect(result.current.deactivate.isSuccess).toBe(true));

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/usuarios/7/deactivate');
    expect(call?.[1]?.method).toBe('POST');
    expect(call?.[1]?.body).toBeUndefined();
  });

  it('reactivate sends a bodyless POST to /usuarios/:id/reactivate', async () => {
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
          debeCambiarPassword: false,
          creadoEn: '2026-01-01T12:00:00.000Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { Wrapper } = buildWrapper();

    const { result } = renderHook(() => useEstadoUsuario(), {
      wrapper: Wrapper,
    });

    result.current.reactivate.mutate('7');

    await waitFor(() => expect(result.current.reactivate.isSuccess).toBe(true));

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/usuarios/7/reactivate');
    expect(call?.[1]?.method).toBe('POST');
    expect(call?.[1]?.body).toBeUndefined();
  });

  it('deactivate invalidates lists() and detail(id) on success, never setQueryData (D9)', async () => {
    stubFetchOk();
    const { Wrapper, invalidateSpy, setQueryDataSpy } = buildWrapper();

    const { result } = renderHook(() => useEstadoUsuario(), {
      wrapper: Wrapper,
    });

    result.current.deactivate.mutate('7');

    await waitFor(() => expect(result.current.deactivate.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(usuariosKeys.lists());
    expect(invalidatedKeys).toContainEqual(usuariosKeys.detail('7'));
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });

  it('reactivate invalidates lists() and detail(id) on success, never setQueryData (D9)', async () => {
    stubFetchOk();
    const { Wrapper, invalidateSpy, setQueryDataSpy } = buildWrapper();

    const { result } = renderHook(() => useEstadoUsuario(), {
      wrapper: Wrapper,
    });

    result.current.reactivate.mutate('7');

    await waitFor(() => expect(result.current.reactivate.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(usuariosKeys.lists());
    expect(invalidatedKeys).toContainEqual(usuariosKeys.detail('7'));
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });

  it('a 409 LAST_ACTIVE_ENCARGADO on deactivate also invalidates lists()', async () => {
    stubFetch409LastActiveEncargado();
    const { Wrapper, invalidateSpy } = buildWrapper();

    const { result } = renderHook(() => useEstadoUsuario(), {
      wrapper: Wrapper,
    });

    result.current.deactivate.mutate('7');

    await waitFor(() => expect(result.current.deactivate.isError).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(usuariosKeys.lists());
  });
});
