import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertasKeys } from './queries.js';
import { useResolverAlerta } from './useResolverAlerta.js';

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

describe('useResolverAlerta', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /alertas/:id/resolver and returns the resolved alerta', async () => {
    const resolved = {
      id: 'a1',
      productoId: 'p1',
      tipo: 'discrepancia',
      estado: 'resuelta',
      movimientoId: null,
      creadaEn: '2026-09-01T00:00:00.000Z',
      resueltaEn: '2026-09-02T00:00:00.000Z',
      resueltaPor: 'u1',
    };
    const fetchMock = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        ok(200, { alerta: resolved }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useResolverAlerta(), {
      wrapper: Wrapper,
    });
    result.current.mutate('a1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.alerta).toEqual(resolved);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/alertas/a1/resolver',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('invalidates alertasKeys.all on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        ok(200, {
          alerta: {
            id: 'a2',
            productoId: 'p2',
            tipo: 'discrepancia',
            estado: 'resuelta',
            movimientoId: null,
            creadaEn: '2026-09-01T00:00:00.000Z',
            resueltaEn: '2026-09-02T00:00:00.000Z',
            resueltaPor: 'u1',
          },
        }),
      ),
    );
    const { Wrapper, invalidateSpy } = makeWrapper();

    const { result } = renderHook(() => useResolverAlerta(), {
      wrapper: Wrapper,
    });
    result.current.mutate('a2');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: alertasKeys.all,
    });
  });
});
