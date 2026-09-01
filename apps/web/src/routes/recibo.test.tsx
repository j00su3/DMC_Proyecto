import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from './routeTree.js';

const encargadoUsuario = {
  id: 'usr-1',
  nombre: 'Carla Núñez',
  email: 'carla@test.com',
  rol: 'encargado' as const,
  debeCambiarPassword: false,
};
const depositoUsuario = {
  id: 'usr-2',
  nombre: 'Beto Ruiz',
  email: 'beto@test.com',
  rol: 'deposito' as const,
  debeCambiarPassword: false,
};

const VENTA_ID = 'venta-1';

const RECIBO_RESPONSE = {
  venta: {
    id: VENTA_ID,
    numeroCorrelativo: 42,
    usuarioId: 'usr-1',
    estado: 'confirmada' as const,
    total: '150.00',
    creadoEn: '2026-08-31T15:30:00.000Z',
  },
  cajero: { id: 'usr-1', nombre: 'Ana Torres' },
  items: [
    {
      id: 'item-1',
      ventaId: VENTA_ID,
      productoId: 'prod-1',
      cantidad: 2,
      precioUnitario: '50.00',
      subtotal: '100.00',
      nombre: 'Martillo',
    },
  ],
  pagos: [
    {
      id: 'pago-1',
      ventaId: VENTA_ID,
      medio: 'efectivo' as const,
      monto: '150.00',
      vuelto: '0.00',
      estado: 'registrado' as const,
    },
  ],
};

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stubFetch({
  usuario,
  ventaExists = true,
}: {
  usuario: typeof encargadoUsuario | typeof depositoUsuario;
  ventaExists?: boolean;
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/auth/me')) return ok(200, { usuario });

      if (url.includes(`/api/ventas/${VENTA_ID}`)) {
        return ventaExists
          ? ok(200, RECIBO_RESPONSE)
          : ok(404, {
              error: {
                code: 'SALE_NOT_FOUND',
                message: 'No se encontró la venta.',
              },
            });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function loadAndRenderRecibo(id = VENTA_ID) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = createMemoryHistory({
    initialEntries: [`/ventas/${id}/recibo`],
  });
  const router = createRouter({ routeTree, context: { queryClient }, history });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** recibo-ui / Printable Receipt Route, Receipt Access Is Audit-Style
 * (PD-4). Route-level (Phase 3, Task 3.2). `await router.load()` before
 * every render, per CLAUDE.md's house rule. */
describe('/ventas/$id/recibo route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders every PD-2 field for a valid id', async () => {
    stubFetch({ usuario: encargadoUsuario });
    await loadAndRenderRecibo();

    expect(await screen.findByText('Martillo')).toBeInTheDocument();
    expect(screen.getByText('Ana Torres')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('confirmada')).toBeInTheDocument();
  });

  it('shows the generic not-found message for a nonexistent id', async () => {
    stubFetch({ usuario: encargadoUsuario, ventaExists: false });
    await loadAndRenderRecibo();

    expect(
      await screen.findByText(
        'No se encontró ningún recibo con ese número o identificador.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Buscar otro recibo' }),
    ).toHaveAttribute('href', '/ventas/recibo');
  });

  it('triggers window.print() when Imprimir is activated', async () => {
    stubFetch({ usuario: encargadoUsuario });
    const printSpy = vi.fn();
    vi.stubGlobal('print', printSpy);
    const user = userEvent.setup();
    await loadAndRenderRecibo();

    await user.click(await screen.findByRole('button', { name: 'Imprimir' }));

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('navigates to /pos when Volver is activated — window.history.back() no-ops on a fresh page load with no prior in-app history', async () => {
    stubFetch({ usuario: encargadoUsuario });
    const user = userEvent.setup();
    const router = await loadAndRenderRecibo();

    await user.click(await screen.findByRole('button', { name: 'Volver' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pos');
    });
  });

  it('lets a deposito session view a receipt confirmed by an encargado (PD-4, audit-style access)', async () => {
    stubFetch({ usuario: depositoUsuario });
    await loadAndRenderRecibo();

    expect(await screen.findByText('Martillo')).toBeInTheDocument();
    expect(screen.getByText('Ana Torres')).toBeInTheDocument();
  });

  it('is reachable under shellLayout, not redirected by an encargado-only guard', async () => {
    stubFetch({ usuario: depositoUsuario });
    const router = await loadAndRenderRecibo();

    await screen.findByText('Martillo');
    expect(router.state.location.pathname).toBe(`/ventas/${VENTA_ID}/recibo`);
  });
});
