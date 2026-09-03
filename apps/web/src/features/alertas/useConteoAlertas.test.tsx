import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConteoAlertas } from './useConteoAlertas.js';

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

describe('useConteoAlertas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the open-alert count from the dedicated conteo route', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request) =>
      ok(200, { abiertas: 3 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useConteoAlertas(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.abiertas).toBe(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/alertas/conteo',
    );
  });

  it('a different count changes the resolved value (triangulation)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => ok(200, { abiertas: 0 })),
    );

    const { result } = renderHook(() => useConteoAlertas(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.abiertas).toBe(0);
  });
});
