import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proveedoresActivosKeys } from '../productos/useProveedoresActivos.js';
import { proveedoresKeys } from './queries.js';
import { useCrearProveedor } from './useCrearProveedor.js';

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
      status: 201,
      json: async () => ({
        proveedor: {
          id: '9',
          nombre: 'Nuevo Proveedor',
          contacto: null,
          activo: true,
          creadoEn: '2026-01-01T12:00:00.000Z',
        },
      }),
    }),
  );
}

describe('useCrearProveedor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invalidates proveedoresKeys.all and proveedoresActivosKeys.all on success, never setQueryData (D3/D9)', async () => {
    stubFetchOk();
    const { Wrapper, invalidateSpy, setQueryDataSpy } = buildWrapper();

    const { result } = renderHook(() => useCrearProveedor(), {
      wrapper: Wrapper,
    });

    result.current.mutate({ nombre: 'Nuevo Proveedor', contacto: null });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(proveedoresKeys.all);
    expect(invalidatedKeys).toContainEqual(proveedoresActivosKeys.all);
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });
});
