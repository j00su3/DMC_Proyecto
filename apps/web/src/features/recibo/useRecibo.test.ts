import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isApiError } from '../../api/errors.js';
import { reciboKeys } from './queries.js';
import { useRecibo, useReciboPorNumero } from './useRecibo.js';

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
  return { Wrapper, queryClient };
}

const RECIBO = {
  venta: {
    id: '7',
    numeroCorrelativo: 42,
    usuarioId: 'u1',
    estado: 'confirmada' as const,
    total: '100.00',
    creadoEn: '2026-01-01T12:00:00.000Z',
  },
  cajero: { id: 'u1', nombre: 'Ana' },
  items: [],
  pagos: [],
};

describe('useRecibo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queries reciboKeys.detail(id) and returns the receipt on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => RECIBO,
      }),
    );
    const { Wrapper, queryClient } = buildWrapper();

    const { result } = renderHook(() => useRecibo('7'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual(RECIBO));
    expect(queryClient.getQueryData(reciboKeys.detail('7'))).toEqual(RECIBO);
  });

  it('surfaces SALE_NOT_FOUND as an ApiError untouched on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: { code: 'SALE_NOT_FOUND', message: 'not found' },
        }),
      }),
    );
    const { Wrapper } = buildWrapper();

    const { result } = renderHook(() => useRecibo('missing'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isApiError(result.current.error) && result.current.error.code).toBe(
      'SALE_NOT_FOUND',
    );
  });
});

describe('useReciboPorNumero', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fetch when disabled (numero not yet submitted)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { Wrapper } = buildWrapper();

    renderHook(() => useReciboPorNumero(42, false), { wrapper: Wrapper });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches reciboKeys.byNumero(numero) once enabled and returns the receipt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => RECIBO,
      }),
    );
    const { Wrapper, queryClient } = buildWrapper();

    const { result } = renderHook(() => useReciboPorNumero(42, true), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual(RECIBO));
    expect(queryClient.getQueryData(reciboKeys.byNumero(42))).toEqual(RECIBO);
  });

  it('surfaces SALE_NOT_FOUND as an ApiError untouched on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: { code: 'SALE_NOT_FOUND', message: 'not found' },
        }),
      }),
    );
    const { Wrapper } = buildWrapper();

    const { result } = renderHook(() => useReciboPorNumero(999, true), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isApiError(result.current.error) && result.current.error.code).toBe(
      'SALE_NOT_FOUND',
    );
  });
});
