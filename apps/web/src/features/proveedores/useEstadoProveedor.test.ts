import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proveedoresActivosKeys } from '../productos/useProveedoresActivos.js';
import { proveedoresKeys } from './queries.js';
import { useEstadoProveedor } from './useEstadoProveedor.js';

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

function stubFetchOk(activo: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        proveedor: {
          id: '7',
          nombre: 'Acme',
          contacto: null,
          activo,
          creadoEn: '2026-01-01T12:00:00.000Z',
        },
      }),
    }),
  );
}

describe('useEstadoProveedor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deactivate sends a bodyless POST to /proveedores/:id/deactivate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        proveedor: {
          id: '7',
          nombre: 'Acme',
          contacto: null,
          activo: false,
          creadoEn: '2026-01-01T12:00:00.000Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { Wrapper } = buildWrapper();

    const { result } = renderHook(() => useEstadoProveedor(), {
      wrapper: Wrapper,
    });

    result.current.deactivate.mutate('7');

    await waitFor(() => expect(result.current.deactivate.isSuccess).toBe(true));

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/proveedores/7/deactivate');
    expect(call?.[1]?.method).toBe('POST');
    expect(call?.[1]?.body).toBeUndefined();
  });

  it('reactivate sends a bodyless POST to /proveedores/:id/reactivate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        proveedor: {
          id: '7',
          nombre: 'Acme',
          contacto: null,
          activo: true,
          creadoEn: '2026-01-01T12:00:00.000Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { Wrapper } = buildWrapper();

    const { result } = renderHook(() => useEstadoProveedor(), {
      wrapper: Wrapper,
    });

    result.current.reactivate.mutate('7');

    await waitFor(() => expect(result.current.reactivate.isSuccess).toBe(true));

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/proveedores/7/reactivate');
    expect(call?.[1]?.method).toBe('POST');
    expect(call?.[1]?.body).toBeUndefined();
  });

  it('deactivate invalidates proveedoresKeys.all and proveedoresActivosKeys.all, never setQueryData (D3/D9)', async () => {
    stubFetchOk(false);
    const { Wrapper, invalidateSpy, setQueryDataSpy } = buildWrapper();

    const { result } = renderHook(() => useEstadoProveedor(), {
      wrapper: Wrapper,
    });

    result.current.deactivate.mutate('7');

    await waitFor(() => expect(result.current.deactivate.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(proveedoresKeys.all);
    expect(invalidatedKeys).toContainEqual(proveedoresActivosKeys.all);
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });

  it('reactivate invalidates proveedoresKeys.all and proveedoresActivosKeys.all, never setQueryData (D3/D9)', async () => {
    stubFetchOk(true);
    const { Wrapper, invalidateSpy, setQueryDataSpy } = buildWrapper();

    const { result } = renderHook(() => useEstadoProveedor(), {
      wrapper: Wrapper,
    });

    result.current.reactivate.mutate('7');

    await waitFor(() => expect(result.current.reactivate.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(proveedoresKeys.all);
    expect(invalidatedKeys).toContainEqual(proveedoresActivosKeys.all);
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });
});
