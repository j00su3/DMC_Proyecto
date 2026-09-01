import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PagoPanel } from './PagoPanel.js';
import type { CarritoLinea } from './carrito.js';

const LINEA: CarritoLinea = {
  productoId: '11111111-1111-4111-8111-111111111111',
  nombre: 'Producto A',
  sku: 'SKU-A',
  precioSnapshot: '100.00',
  cantidad: 1,
  stockActual: 5,
};

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
          total: '100.00',
          creadoEn: '2026-01-01T00:00:00.000Z',
        },
        items: [],
        pagos: [],
      }),
    }),
  );
}

function stubFetchPriceChanged() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: {
          code: 'PRICE_CHANGED',
          message: 'price changed',
          details: {
            items: [
              {
                productoId: LINEA.productoId,
                precioEsperado: '100.00',
                precioActual: '120.00',
              },
            ],
          },
        },
      }),
    }),
  );
}

describe('PagoPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the cart total via dinero.ts (precio × cantidad)', () => {
    const Wrapper = buildWrapper();
    render(
      <PagoPanel
        items={[LINEA]}
        vaciarCarrito={vi.fn()}
        onVentaConfirmada={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText('$100.00')).toBeInTheDocument();
  });

  it('combines two entries for the same medio into one before submission (PD-7)', async () => {
    stubFetchOk();
    const user = userEvent.setup();
    const Wrapper = buildWrapper();
    render(
      <PagoPanel
        items={[LINEA]}
        vaciarCarrito={vi.fn()}
        onVentaConfirmada={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    const montoInput = screen.getByLabelText('Monto');
    await user.type(montoInput, '30.00');
    await user.click(screen.getByRole('button', { name: 'Agregar pago' }));
    await user.clear(montoInput);
    await user.type(montoInput, '20.00');
    await user.click(screen.getByRole('button', { name: 'Agregar pago' }));

    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getAllByText('$50.00')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Confirmar venta' }));

    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalled();
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call?.[1]?.body as string);
    expect(body.pagos).toEqual([{ medio: 'efectivo', monto: '50.00' }]);
  });

  it('shows vuelto attached to the cash entry only when it overpays (PD-2)', async () => {
    stubFetchOk();
    const user = userEvent.setup();
    const Wrapper = buildWrapper();
    render(
      <PagoPanel
        items={[LINEA]}
        vaciarCarrito={vi.fn()}
        onVentaConfirmada={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    await user.type(screen.getByLabelText('Monto'), '150.00');
    await user.click(screen.getByRole('button', { name: 'Agregar pago' }));

    expect(screen.getByText('Vuelto $50.00')).toBeInTheDocument();
  });

  it('shows no vuelto for a card-only payment', async () => {
    const user = userEvent.setup();
    const Wrapper = buildWrapper();
    render(
      <PagoPanel
        items={[LINEA]}
        vaciarCarrito={vi.fn()}
        onVentaConfirmada={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    await user.type(screen.getByLabelText('Monto'), '100.00');
    await user.click(screen.getByRole('button', { name: 'Agregar pago' }));

    expect(screen.queryByText(/Vuelto/)).not.toBeInTheDocument();
  });

  it('on PRICE_CHANGED shows a mismatch notice naming the product and does not auto-resubmit (PD-6)', async () => {
    stubFetchPriceChanged();
    const user = userEvent.setup();
    const Wrapper = buildWrapper();
    render(
      <PagoPanel
        items={[LINEA]}
        vaciarCarrito={vi.fn()}
        onVentaConfirmada={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    await user.type(screen.getByLabelText('Monto'), '100.00');
    await user.click(screen.getByRole('button', { name: 'Agregar pago' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar venta' }));

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('Producto A');
    expect(notice).toHaveTextContent('100.00');
    expect(notice).toHaveTextContent('120.00');

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Confirmar venta' }),
    ).toBeDisabled();
  });

  it('explicit re-confirmation resubmits once with the server-reported price', async () => {
    stubFetchPriceChanged();
    const user = userEvent.setup();
    const Wrapper = buildWrapper();
    render(
      <PagoPanel
        items={[LINEA]}
        vaciarCarrito={vi.fn()}
        onVentaConfirmada={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    await user.type(screen.getByLabelText('Monto'), '100.00');
    await user.click(screen.getByRole('button', { name: 'Agregar pago' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar venta' }));
    await screen.findByRole('alert');

    stubFetchOk();
    await user.click(
      screen.getByRole('button', { name: 'Confirmar con los nuevos precios' }),
    );

    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call?.[1]?.body as string);
    expect(body.items[0].precioUnitarioEsperado).toBe('120.00');
  });

  it('calls onVentaConfirmada with the confirmed venta on a successful mutate', async () => {
    stubFetchOk();
    const user = userEvent.setup();
    const Wrapper = buildWrapper();
    const onVentaConfirmada = vi.fn();
    render(
      <PagoPanel
        items={[LINEA]}
        vaciarCarrito={vi.fn()}
        onVentaConfirmada={onVentaConfirmada}
      />,
      { wrapper: Wrapper },
    );

    await user.type(screen.getByLabelText('Monto'), '100.00');
    await user.click(screen.getByRole('button', { name: 'Agregar pago' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar venta' }));

    await waitFor(() => {
      expect(onVentaConfirmada).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'venta-1', numeroCorrelativo: 1 }),
      );
    });
  });

  it('calls onVentaConfirmada on the PRICE_CHANGED re-confirmation path too', async () => {
    stubFetchPriceChanged();
    const user = userEvent.setup();
    const Wrapper = buildWrapper();
    const onVentaConfirmada = vi.fn();
    render(
      <PagoPanel
        items={[LINEA]}
        vaciarCarrito={vi.fn()}
        onVentaConfirmada={onVentaConfirmada}
      />,
      { wrapper: Wrapper },
    );

    await user.type(screen.getByLabelText('Monto'), '100.00');
    await user.click(screen.getByRole('button', { name: 'Agregar pago' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar venta' }));
    await screen.findByRole('alert');

    stubFetchOk();
    await user.click(
      screen.getByRole('button', { name: 'Confirmar con los nuevos precios' }),
    );

    await waitFor(() => {
      expect(onVentaConfirmada).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'venta-1', numeroCorrelativo: 1 }),
      );
    });
  });
});
