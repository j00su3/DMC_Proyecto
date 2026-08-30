import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SIZE } from '../features/productos/queries.js';
import { routeTree } from './routeTree.js';

const depositoUsuario = {
  id: '2',
  nombre: 'Beto Ruiz',
  email: 'beto@test.com',
  rol: 'deposito' as const,
  debeCambiarPassword: false,
};

async function loadAndRenderProductos(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({ routeTree, context: { queryClient }, history });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function productoRow(
  id: string,
  overrides: {
    nombre?: string;
    stockActual?: number;
    stockMinimo?: number | null;
  } = {},
) {
  return {
    id,
    nombre: `Producto ${id}`,
    sku: `SKU-${id}`,
    categoria: 'General',
    stockActual: 10,
    stockMinimo: 5,
    precio: '19.99',
    proveedorId: 'prov-1',
    activo: true,
    creadoEn: '2026-01-01T12:00:00.000Z',
    ...overrides,
  };
}

function stubFetchAsDepositoWithList(listResponse: {
  data: ReturnType<typeof productoRow>[];
  page: number;
  pageSize: number;
  total: number;
}) {
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
      if (url.includes('/api/productos')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => listResponse,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

/**
 * productos-ui / Product List Is Open To Both Roles Under shellLayout, and
 * List With Pagination... (pagination half). Route-level coverage, not just
 * hook-level (house rule): `router.load()` is awaited before every render,
 * per the diagnosed full-suite flake documented in usuarios.test.ts.
 */
describe('productos routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders /inventario for a deposito session with no route redirect', async () => {
    stubFetchAsDepositoWithList({
      data: [productoRow('1')],
      page: 1,
      pageSize: PAGE_SIZE,
      total: 1,
    });
    const router = await loadAndRenderProductos('/inventario');

    expect(router.state.location.pathname).toBe('/inventario');
    expect(await screen.findByText('Producto 1')).toBeInTheDocument();
  });

  it("renders DataTable rows from GET /api/productos's data", async () => {
    stubFetchAsDepositoWithList({
      data: [productoRow('1'), productoRow('2', { nombre: 'Producto 2' })],
      page: 1,
      pageSize: PAGE_SIZE,
      total: 2,
    });
    await loadAndRenderProductos('/inventario');

    expect(await screen.findByText('Producto 1')).toBeInTheDocument();
    expect(screen.getByText('Producto 2')).toBeInTheDocument();
  });

  it("derives the pagination footer from the envelope's page/pageSize/total", async () => {
    stubFetchAsDepositoWithList({
      data: [productoRow('1')],
      page: 1,
      pageSize: PAGE_SIZE,
      // 41 rows over a page size of 20 is three pages, and the last one is
      // partial — a floor instead of a ceiling would lose it.
      total: PAGE_SIZE * 2 + 1,
    });
    await loadAndRenderProductos('/inventario');

    const footer = await screen.findByRole('navigation', {
      name: 'Paginación',
    });
    expect(within(footer).getByRole('button', { name: '1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(footer).getByRole('button', { name: '3' }),
    ).toBeInTheDocument();
    expect(within(footer).queryByRole('button', { name: '4' })).toBeNull();
  });

  /** productos-ui / List With Pagination, Search... (search half). */
  it('search input filters the list by ?q=, matching only the searched name', async () => {
    const all = [
      productoRow('1', { nombre: 'Martillo' }),
      productoRow('2', { nombre: 'Taladro' }),
    ];
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
        if (url.includes('/api/productos')) {
          const q = new URL(url, 'http://x').searchParams.get('q') ?? '';
          const data = q
            ? all.filter((p) =>
                p.nombre.toLowerCase().includes(q.toLowerCase()),
              )
            : all;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data,
              page: 1,
              pageSize: PAGE_SIZE,
              total: data.length,
            }),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    await loadAndRenderProductos('/inventario');
    await screen.findByText('Martillo');

    await userEvent.type(
      screen.getByLabelText('Buscar por nombre o SKU'),
      'Tal',
    );

    await waitFor(() =>
      expect(screen.queryByText('Martillo')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Taladro')).toBeInTheDocument();
  });

  it('resets ?page to 1 when the search term changes', async () => {
    stubFetchAsDepositoWithList({
      data: [productoRow('1')],
      page: 2,
      pageSize: PAGE_SIZE,
      total: 1,
    });
    const router = await loadAndRenderProductos('/inventario?page=2');

    await userEvent.type(screen.getByLabelText('Buscar por nombre o SKU'), 'x');

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ page: 1 }),
    );
  });

  /** productos-ui / List With Pagination... (derived status chip half, D9). */
  it.each([
    [{ stockMinimo: null, stockActual: 3 }, null],
    [{ stockMinimo: 10, stockActual: 8 }, 'Bajo'],
    [{ stockMinimo: 10, stockActual: 0 }, 'Quiebre'],
  ])('derives the status chip for %o', async (overrides, expectedLabel) => {
    stubFetchAsDepositoWithList({
      data: [productoRow('1', overrides)],
      page: 1,
      pageSize: PAGE_SIZE,
      total: 1,
    });
    await loadAndRenderProductos('/inventario');
    await screen.findByText('Producto 1');

    if (expectedLabel) {
      expect(screen.getByText(expectedLabel)).toBeInTheDocument();
    } else {
      expect(screen.queryByText('Bajo')).not.toBeInTheDocument();
      expect(screen.queryByText('Quiebre')).not.toBeInTheDocument();
    }
  });

  /**
   * productos-ui / Error Surfacing By Code. The full six-code mapping is
   * proven at the unit level in `errorMessages.test.ts` (mirrors
   * `usuarios/errorMessages.test.ts`'s precedent); this is the one
   * route-level proof that the mapper is actually wired into the screen,
   * not a generic fallback.
   */
  it('surfaces the mapped error message for a failed list request, not a generic fallback', async () => {
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
        if (url.includes('/api/productos')) {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: async () => ({
              error: { code: 'VALIDATION_ERROR', message: 'bad request' },
            }),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    await loadAndRenderProductos('/inventario');

    expect(
      await screen.findByText(
        'Revise los datos ingresados e intente de nuevo.',
      ),
    ).toBeInTheDocument();
  });
});
