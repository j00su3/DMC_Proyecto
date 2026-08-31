import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { productosKeys } from '../productos/queries.js';
import { useConfirmarVenta } from './useConfirmarVenta.js';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  }
  return { Wrapper, invalidateSpy };
}

const INPUT = {
  items: [
    {
      productoId: '22222222-2222-4222-8222-222222222222',
      cantidad: 1,
      precioUnitarioEsperado: '10.00',
    },
  ],
  pagos: [{ medio: 'efectivo' as const, monto: '10.00' }],
};

function stubFetchOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        venta: {
          id: 'venta-1',
          numeroCorrelativo: 1,
          usuarioId: 'usuario-1',
          estado: 'confirmada',
          total: '10.00',
          creadoEn: '2026-01-01T00:00:00.000Z',
        },
        items: [],
        pagos: [],
      }),
    }),
  );
}

function stubFetch409(code: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code, message: 'x' },
      }),
    }),
  );
}

describe('useConfirmarVenta', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a POST to /ventas with the given input', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        venta: {
          id: 'venta-1',
          numeroCorrelativo: 1,
          usuarioId: 'usuario-1',
          estado: 'confirmada',
          total: '10.00',
          creadoEn: '2026-01-01T00:00:00.000Z',
        },
        items: [],
        pagos: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { Wrapper } = buildWrapper();
    const vaciarCarrito = vi.fn();

    const { result } = renderHook(() => useConfirmarVenta(vaciarCarrito), {
      wrapper: Wrapper,
    });

    result.current.mutate(INPUT);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/ventas');
    expect(call?.[1]?.method).toBe('POST');
    expect(JSON.parse(call?.[1]?.body as string)).toEqual(INPUT);
  });

  it('on success, empties the cart (PD-9) and invalidates productosKeys.all', async () => {
    stubFetchOk();
    const { Wrapper, invalidateSpy } = buildWrapper();
    const vaciarCarrito = vi.fn();

    const { result } = renderHook(() => useConfirmarVenta(vaciarCarrito), {
      wrapper: Wrapper,
    });

    result.current.mutate(INPUT);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vaciarCarrito).toHaveBeenCalledOnce();
    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(productosKeys.all);
  });

  it('on PRICE_CHANGED, does NOT empty the cart — the sale stays open (PD-6)', async () => {
    stubFetch409('PRICE_CHANGED');
    const { Wrapper, invalidateSpy } = buildWrapper();
    const vaciarCarrito = vi.fn();

    const { result } = renderHook(() => useConfirmarVenta(vaciarCarrito), {
      wrapper: Wrapper,
    });

    result.current.mutate(INPUT);

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(vaciarCarrito).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
