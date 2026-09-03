import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertasKeys } from './queries.js';
import { useMarcarVistas } from './useMarcarVistas.js';

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper, invalidateSpy };
}

describe('useMarcarVistas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires the POST once on mount without any user action', async () => {
    const fetchMock = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        ok(200, { marcadas: 2 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useMarcarVistas(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/alertas/marcar-vistas',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('invalidates alertasKeys.all on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => ok(200, { marcadas: 0 })),
    );
    const { Wrapper, invalidateSpy } = makeWrapper();

    const { result } = renderHook(() => useMarcarVistas(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: alertasKeys.all });
  });

  it('does not re-fire on re-render (stays fired exactly once)', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request) =>
      ok(200, { marcadas: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { Wrapper } = makeWrapper();

    const { result, rerender } = renderHook(() => useMarcarVistas(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender();
    rerender();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
