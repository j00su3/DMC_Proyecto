import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors.js';
import { productosKeys } from '../productos/queries.js';
import { reciboKeys } from './queries.js';
import { useAnularVenta } from './useAnularVenta.js';

const VENTA_ID = 'venta-1';

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

/**
 * Phase 6.2 — `useAnularVenta` mutation hook (design's Data Flow):
 * `POST /api/ventas/:id/anular`, invalidates `reciboKeys.detail(id)` +
 * `productosKeys.all` on success; a server error surfaces as an `ApiError`.
 */
describe('useAnularVenta', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('POSTs the motivo to /api/ventas/:id/anular and invalidates reciboKeys.detail + productosKeys.all on success', async () => {
    const fetchMock = vi.fn(() =>
      ok(200, {
        venta: { id: VENTA_ID, estado: 'anulada' },
        items: [],
        pagos: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useAnularVenta(VENTA_ID), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ motivoAnulacion: 'Cliente se retractó del pago' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/ventas/${VENTA_ID}/anular`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          motivoAnulacion: 'Cliente se retractó del pago',
        }),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: reciboKeys.detail(VENTA_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: productosKeys.all,
    });
  });

  it('surfaces a server refusal as a typed ApiError', async () => {
    vi.stubGlobal('fetch', () =>
      ok(409, {
        error: { code: 'SALE_ALREADY_VOIDED', message: 'Ya fue anulada.' },
      }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    const { result } = renderHook(() => useAnularVenta(VENTA_ID), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ motivoAnulacion: 'Cliente se retractó del pago' });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe('SALE_ALREADY_VOIDED');
  });
});
