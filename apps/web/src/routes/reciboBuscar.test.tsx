import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
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
const NUMERO_CORRELATIVO = 42;

const RECIBO_RESPONSE = {
  venta: {
    id: VENTA_ID,
    numeroCorrelativo: NUMERO_CORRELATIVO,
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

      if (url.includes(`/api/ventas/numero/${NUMERO_CORRELATIVO}`)) {
        return ventaExists
          ? ok(200, RECIBO_RESPONSE)
          : ok(404, {
              error: {
                code: 'SALE_NOT_FOUND',
                message: 'No se encontró la venta.',
              },
            });
      }

      // Navigating on a match lands on `/ventas/$id/recibo` (D3), which
      // independently fetches the detail by id — stub it too so the
      // navigation assertion exercises the real route, not a stub gap.
      if (url.includes(`/api/ventas/${VENTA_ID}`)) {
        return ok(200, RECIBO_RESPONSE);
      }

      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function loadAndRenderBuscar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = createMemoryHistory({
    initialEntries: ['/ventas/recibo'],
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

/** recibo-ui / Correlativo Search (D3, Phase 4, Task 4.1). Route-level,
 * `await router.load()` before every render, per CLAUDE.md. */
describe('/ventas/recibo route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('navigates to the receipt route when the numeroCorrelativo matches', async () => {
    stubFetch({ usuario: encargadoUsuario });
    const user = userEvent.setup();
    const router = await loadAndRenderBuscar();

    await user.type(
      screen.getByLabelText('Número correlativo'),
      String(NUMERO_CORRELATIVO),
    );
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('Martillo')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/ventas/${VENTA_ID}/recibo`);
  });

  it('shows the generic not-found message and does not navigate for a nonexistent numeroCorrelativo', async () => {
    stubFetch({ usuario: encargadoUsuario, ventaExists: false });
    const user = userEvent.setup();
    const router = await loadAndRenderBuscar();

    await user.type(
      screen.getByLabelText('Número correlativo'),
      String(NUMERO_CORRELATIVO),
    );
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(
      await screen.findByText(
        'No se encontró ningún recibo con ese número o identificador.',
      ),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/ventas/recibo');
  });

  it('shows a validation message and does not call the API for an empty submission', async () => {
    stubFetch({ usuario: encargadoUsuario });
    const user = userEvent.setup();
    const router = await loadAndRenderBuscar();

    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(
      await screen.findByText('Ingrese un número correlativo válido.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/ventas/recibo');
  });

  it('has no list/browse control on the page', async () => {
    stubFetch({ usuario: encargadoUsuario });
    await loadAndRenderBuscar();

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('is reachable by a deposito session (PD-4, audit-style access)', async () => {
    stubFetch({ usuario: depositoUsuario });
    const user = userEvent.setup();
    const router = await loadAndRenderBuscar();

    await user.type(
      screen.getByLabelText('Número correlativo'),
      String(NUMERO_CORRELATIVO),
    );
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('Martillo')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/ventas/${VENTA_ID}/recibo`);
  });
});
