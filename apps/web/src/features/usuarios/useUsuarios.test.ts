import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUsuarios } from './useUsuarios.js';

function usuario(id: string, nombre: string) {
  return {
    id,
    nombre,
    email: `${nombre.toLowerCase()}@test.com`,
    rol: 'deposito' as const,
    activo: true,
    debeCambiarPassword: false,
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

describe('useUsuarios', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps page-1 rows visible and reports placeholder data while page-2 request is in flight (D8)', async () => {
    const page1Response = {
      data: [usuario('1', 'Ana')],
      page: 1,
      pageSize: 20,
      total: 21,
    };
    let resolvePage2: (value: unknown) => void = () => {};
    const page2Promise = new Promise((resolve) => {
      resolvePage2 = resolve;
    });

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('page=2')) {
        return page2Promise.then((body) => ({
          ok: true,
          status: 200,
          json: async () => body,
        }));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => page1Response,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const Wrapper = buildWrapper();
    const { result, rerender } = renderHook(({ page }) => useUsuarios(page), {
      initialProps: { page: 1 },
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual(page1Response));

    rerender({ page: 2 });

    // page-2 is still in flight: page-1 rows remain, flagged as placeholder.
    expect(result.current.data).toEqual(page1Response);
    expect(result.current.isPlaceholderData).toBe(true);

    resolvePage2({
      data: [usuario('2', 'Beto')],
      page: 2,
      pageSize: 20,
      total: 21,
    });

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data?.data[0]?.nombre).toBe('Beto');
  });
});
