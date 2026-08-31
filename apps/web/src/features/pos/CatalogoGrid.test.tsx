import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogoGrid } from './CatalogoGrid.js';

const PRODUCTO_A = {
  id: '11111111-1111-4111-8111-111111111111',
  nombre: 'Producto A',
  sku: 'SKU-A',
  categoria: null,
  stockActual: 5,
  stockMinimo: 1,
  precio: '10.00',
  proveedorId: 'proveedor-1',
  activo: true,
  creadoEn: '2026-01-01T00:00:00.000Z',
};

const PRODUCTO_SIN_STOCK = {
  ...PRODUCTO_A,
  id: '22222222-2222-4222-8222-222222222222',
  nombre: 'Producto sin stock',
  sku: 'SKU-B',
  stockActual: 0,
};

function stubCatalogoFetch(data: (typeof PRODUCTO_A)[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data, page: 1, pageSize: 20, total: data.length }),
    }),
  );
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

/**
 * `GET /api/ventas/catalogo` already excludes inactive products server-side
 * (PD-8, D11's `soloActivos`) and orders alphabetically (PD-12) — this
 * suite exercises the client-only behaviors: zero-stock disabled add, the
 * `AGREGAR` dispatch on click, and the `bloqueoStock` notice.
 */
describe('CatalogoGrid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders exactly the products the server returns, never re-filtering client-side (PD-8 exclusion is server-owned)', async () => {
    stubCatalogoFetch([PRODUCTO_A, PRODUCTO_SIN_STOCK]);
    const Wrapper = buildWrapper();

    render(<CatalogoGrid bloqueoStock={null} onAgregar={vi.fn()} />, {
      wrapper: Wrapper,
    });

    expect(await screen.findByText('Producto A')).toBeInTheDocument();
    expect(screen.getByText('Producto sin stock')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('renders an active product with a stock display and an enabled add control', async () => {
    stubCatalogoFetch([PRODUCTO_A]);
    const Wrapper = buildWrapper();

    render(<CatalogoGrid bloqueoStock={null} onAgregar={vi.fn()} />, {
      wrapper: Wrapper,
    });

    expect(await screen.findByText('Producto A')).toBeInTheDocument();
    expect(screen.getByText('Stock: 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeEnabled();
  });

  it('shows a zero-stock active product visibly but with its add control disabled (PD-8)', async () => {
    stubCatalogoFetch([PRODUCTO_SIN_STOCK]);
    const Wrapper = buildWrapper();

    render(<CatalogoGrid bloqueoStock={null} onAgregar={vi.fn()} />, {
      wrapper: Wrapper,
    });

    expect(await screen.findByText('Producto sin stock')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sin stock' })).toBeDisabled();
  });

  it('dispatches onAgregar with the catalog DTO mapped to ProductoParaCarrito', async () => {
    stubCatalogoFetch([PRODUCTO_A]);
    const Wrapper = buildWrapper();
    const onAgregar = vi.fn();
    const user = userEvent.setup();

    render(<CatalogoGrid bloqueoStock={null} onAgregar={onAgregar} />, {
      wrapper: Wrapper,
    });

    await user.click(await screen.findByRole('button', { name: 'Agregar' }));

    expect(onAgregar).toHaveBeenCalledWith({
      productoId: PRODUCTO_A.id,
      nombre: PRODUCTO_A.nombre,
      sku: PRODUCTO_A.sku,
      precio: PRODUCTO_A.precio,
      stockActual: PRODUCTO_A.stockActual,
    });
  });

  it('shows "sin stock disponible" instead of the add control when bloqueoStock matches the product (PD-13)', async () => {
    stubCatalogoFetch([PRODUCTO_A]);
    const Wrapper = buildWrapper();

    render(<CatalogoGrid bloqueoStock={PRODUCTO_A.id} onAgregar={vi.fn()} />, {
      wrapper: Wrapper,
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sin stock disponible',
    );
    expect(
      screen.queryByRole('button', { name: 'Agregar' }),
    ).not.toBeInTheDocument();
  });
});
