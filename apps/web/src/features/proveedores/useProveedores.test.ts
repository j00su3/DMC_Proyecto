import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProveedores } from './useProveedores.js';

function proveedor(id: string, nombre: string) {
  return {
    id,
    nombre,
    contacto: null,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
  };
}

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
  return Wrapper;
}

describe('useProveedores', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports loading then success with the fetched full list', async () => {
    const response = {
      data: [proveedor('1', 'Acme'), proveedor('2', 'Beta')],
      page: 1,
      pageSize: 100,
      total: 2,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => response,
    });
    vi.stubGlobal('fetch', fetchMock);

    const Wrapper = buildWrapper();
    const { result } = renderHook(() => useProveedores(), {
      wrapper: Wrapper,
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(response);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/proveedores?page=1&pageSize=100',
    );
  });
});
