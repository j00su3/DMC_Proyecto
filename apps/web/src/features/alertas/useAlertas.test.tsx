import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAlertas } from './useAlertas.js';

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useAlertas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the alert list and exposes the rows from the response', async () => {
    const row = {
      id: '1',
      productoId: 'p1',
      productoNombre: 'Harina',
      tipo: 'stock_bajo',
      estado: 'activa',
      movimientoId: 'm1',
      creadaEn: '2026-09-01T00:00:00.000Z',
      resueltaEn: null,
      resueltaPor: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => ok(200, { data: [row], page: 1, pageSize: 20, total: 1 })),
    );

    const { result } = renderHook(() => useAlertas(1), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toEqual([row]);
  });

  it('requests the estado filter as a query param when provided', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request) =>
      ok(200, { data: [], page: 1, pageSize: 20, total: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAlertas(1, 'activa'), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('estado=activa');
  });
});
