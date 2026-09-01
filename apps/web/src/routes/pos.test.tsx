import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SIZE } from '../features/pos/queries.js';
import { routeTree } from './routeTree.js';

const encargadoUsuario = {
  id: '1',
  nombre: 'Ana Gómez',
  email: 'ana@test.com',
  rol: 'encargado' as const,
  debeCambiarPassword: false,
};

const depositoUsuario = {
  id: '2',
  nombre: 'Beto Ruiz',
  email: 'beto@test.com',
  rol: 'deposito' as const,
  debeCambiarPassword: false,
};

function catalogoProducto(
  id: string,
  overrides: { nombre?: string; precio?: string; stockActual?: number } = {},
) {
  return {
    id,
    nombre: `Producto ${id}`,
    sku: `SKU-${id}`,
    precio: '10.00',
    stockActual: 5,
    ...overrides,
  };
}

function catalogoResponse(productos: ReturnType<typeof catalogoProducto>[]) {
  return {
    data: productos,
    page: 1,
    pageSize: PAGE_SIZE,
    total: productos.length,
  };
}

async function renderPos(
  usuario: typeof encargadoUsuario | typeof depositoUsuario,
  queryClient: QueryClient,
) {
  const history = createMemoryHistory({ initialEntries: ['/pos'] });
  const router = createRouter({ routeTree, context: { queryClient }, history });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/**
 * pos-ui / Route & Full-Flow Integration (Phase 8). Route-level coverage,
 * not just hook-level (CLAUDE.md house rule); `router.load()` is awaited
 * before every render, per the diagnosed full-suite flake documented in
 * usuarios.test.ts.
 */
describe('pos route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is reachable by a deposito session (Role Gate) and renders catalog + cart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ usuario: depositoUsuario }),
          });
        }
        if (url.includes('/api/ventas/catalogo')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => catalogoResponse([catalogoProducto('1')]),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const router = await renderPos(depositoUsuario, newQueryClient());

    expect(router.state.location.pathname).toBe('/pos');
    expect(await screen.findByText('Producto 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Carrito')).toBeInTheDocument();
    expect(screen.getByLabelText('Pago')).toBeInTheDocument();
  });

  it('adding a product then confirming shows the success screen and invalidates productosKeys.all (PD-9, PD-10)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ usuario: encargadoUsuario }),
          });
        }
        if (url.includes('/api/ventas/catalogo')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => catalogoResponse([catalogoProducto('1')]),
          });
        }
        if (url.includes('/api/ventas') && !url.includes('catalogo')) {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              venta: {
                id: 'v1',
                numeroCorrelativo: 1,
                usuarioId: encargadoUsuario.id,
                estado: 'confirmada',
                total: '10.00',
                creadoEn: '2026-01-01T00:00:00.000Z',
              },
              items: [],
              pagos: [],
            }),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await renderPos(encargadoUsuario, queryClient);

    await screen.findByText('Producto 1');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    const carrito = screen.getByLabelText('Carrito');
    expect(within(carrito).getByText('Producto 1')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Monto'), '10.00');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar pago' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar venta' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Venta confirmada' }),
    ).toBeInTheDocument();
    expect(screen.getByText('#1', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('$10.00', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver recibo' })).toHaveAttribute(
      'href',
      '/ventas/v1/recibo',
    );
    expect(
      screen.getByRole('button', { name: 'Nueva venta' }),
    ).toBeInTheDocument();

    // Success screen replaces the two-pane grid — cart/pago panel unmounted.
    expect(screen.queryByLabelText('Carrito')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pago')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['productos'] }),
      ),
    );
  });

  it('the success screen persists with no auto-dismiss, and "Nueva venta" returns a fresh empty cart and payment lines (D5)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ usuario: encargadoUsuario }),
          });
        }
        if (url.includes('/api/ventas/catalogo')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => catalogoResponse([catalogoProducto('1')]),
          });
        }
        if (url.includes('/api/ventas') && !url.includes('catalogo')) {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              venta: {
                id: 'v1',
                numeroCorrelativo: 1,
                usuarioId: encargadoUsuario.id,
                estado: 'confirmada',
                total: '10.00',
                creadoEn: '2026-01-01T00:00:00.000Z',
              },
              items: [],
              pagos: [],
            }),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    await renderPos(encargadoUsuario, newQueryClient());

    await screen.findByText('Producto 1');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    await userEvent.type(screen.getByLabelText('Monto'), '10.00');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar pago' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar venta' }),
    );

    await screen.findByRole('heading', { name: 'Venta confirmada' });

    // No auto-dismiss: still showing after some time passes with no action.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      screen.getByRole('heading', { name: 'Venta confirmada' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Nueva venta' }));

    expect(
      screen.queryByRole('heading', { name: 'Venta confirmada' }),
    ).not.toBeInTheDocument();
    const carrito = await screen.findByLabelText('Carrito');
    expect(
      within(carrito).getByText('El carrito está vacío'),
    ).toBeInTheDocument();
    // D5's latent-defect fix: PagoPanel's local state (montoInput/pagos) is
    // reset too — the "Agregar pago" input starts empty and no pago line
    // remains, proven by a fresh mount rather than manual reset code.
    expect(screen.getByLabelText('Monto')).toHaveValue('');
    expect(
      screen.queryByText('Vuelto', { exact: false }),
    ).not.toBeInTheDocument();
  });

  it('surfaces PRICE_CHANGED as a re-confirmation notice and does not close the sale (PD-6)', async () => {
    let ventasCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ usuario: encargadoUsuario }),
          });
        }
        if (url.includes('/api/ventas/catalogo')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => catalogoResponse([catalogoProducto('1')]),
          });
        }
        if (url.includes('/api/ventas') && !url.includes('catalogo')) {
          ventasCallCount += 1;
          if (ventasCallCount === 1) {
            return Promise.resolve({
              ok: false,
              status: 409,
              json: async () => ({
                error: {
                  code: 'PRICE_CHANGED',
                  message: 'price changed',
                  details: {
                    items: [
                      {
                        productoId: '1',
                        precioEsperado: '10.00',
                        precioActual: '12.00',
                      },
                    ],
                  },
                },
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              venta: {
                id: 'v1',
                numeroCorrelativo: 1,
                usuarioId: encargadoUsuario.id,
                estado: 'confirmada',
                total: '10.00',
                creadoEn: '2026-01-01T00:00:00.000Z',
              },
              items: [],
              pagos: [],
            }),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    await renderPos(encargadoUsuario, newQueryClient());

    await screen.findByText('Producto 1');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    await userEvent.type(screen.getByLabelText('Monto'), '10.00');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar pago' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar venta' }),
    );

    expect(
      await screen.findByText(
        'Uno o más precios cambiaron. Revise antes de confirmar:',
      ),
    ).toBeInTheDocument();
    const carrito = screen.getByLabelText('Carrito');
    expect(within(carrito).getByText('Producto 1')).toBeInTheDocument();
    expect(ventasCallCount).toBe(1);

    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar con los nuevos precios' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Venta confirmada' }),
    ).toBeInTheDocument();
    expect(ventasCallCount).toBe(2);
  });

  it('explicit "empty cart" action still clears the cart without confirming a sale (regression)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ usuario: encargadoUsuario }),
          });
        }
        if (url.includes('/api/ventas/catalogo')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => catalogoResponse([catalogoProducto('1')]),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    await renderPos(encargadoUsuario, newQueryClient());

    await screen.findByText('Producto 1');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    const carrito = screen.getByLabelText('Carrito');
    expect(within(carrito).getByText('Producto 1')).toBeInTheDocument();

    await userEvent.click(
      within(carrito).getByRole('button', { name: 'Vaciar carrito' }),
    );

    expect(
      within(carrito).getByText('El carrito está vacío'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Venta confirmada' }),
    ).not.toBeInTheDocument();
  });
});
