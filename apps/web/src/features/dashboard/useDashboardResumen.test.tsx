import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDashboardResumen } from './useDashboardResumen.js';

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

describe('useDashboardResumen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the dashboard summary from the resumen route', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request) =>
      ok(200, {
        quiebres: 2,
        stockBajo: 3,
        alertasActivas: 5,
        actividadReciente: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useDashboardResumen(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.quiebres).toBe(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/dashboard/resumen',
    );
  });
});
