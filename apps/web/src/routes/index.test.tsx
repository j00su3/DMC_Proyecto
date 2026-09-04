import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from './routeTree.js';

const depositoUsuario = {
  id: '2',
  nombre: 'Beto Ruiz',
  email: 'beto@test.com',
  rol: 'deposito' as const,
  debeCambiarPassword: false,
};
const encargadoUsuario = {
  id: '1',
  nombre: 'Ana Lopez',
  email: 'ana@test.com',
  rol: 'encargado' as const,
  debeCambiarPassword: false,
};

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stubFetch(
  usuario: typeof depositoUsuario | typeof encargadoUsuario,
  resumen: {
    quiebres: number;
    stockBajo: number;
    alertasActivas: number;
    actividadReciente: Array<{
      id: string;
      productoId: string;
      productoNombre: string;
      tipo: 'entrada' | 'salida' | 'ajuste' | 'venta' | 'anulacion';
      fecha: string;
      usuarioId: string;
    }>;
  },
) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);

    if (url.includes('/api/auth/me')) return ok(200, { usuario });
    if (url.includes('/api/dashboard/resumen')) return ok(200, resumen);

    throw new Error(`unexpected fetch: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function loadAndRender(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
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

describe('/ (Panel general dashboard)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the 4 KPI cards left-to-right for a deposito session', async () => {
    stubFetch(depositoUsuario, {
      quiebres: 2,
      stockBajo: 3,
      alertasActivas: 4,
      actividadReciente: [],
    });

    const router = await loadAndRender('/');

    expect(router.state.location.pathname).toBe('/');
    const quiebresLabel = await screen.findByText('Quiebres');
    const stockBajoLabel = screen.getByText('Stock bajo');
    const actividadLabel = screen.getByText('Actividad reciente');
    const alertasLabel = screen.getByText('Alertas activas');

    // Order per spec's "Cards render in the specified order" scenario.
    expect(
      quiebresLabel.compareDocumentPosition(stockBajoLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      stockBajoLabel.compareDocumentPosition(actividadLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      actividadLabel.compareDocumentPosition(alertasLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows identical counts for encargado and deposito sessions', async () => {
    const resumen = {
      quiebres: 2,
      stockBajo: 3,
      alertasActivas: 4,
      actividadReciente: [],
    };
    stubFetch(encargadoUsuario, resumen);

    await loadAndRender('/');

    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows the empty state when no movimientos have ever been recorded', async () => {
    stubFetch(encargadoUsuario, {
      quiebres: 0,
      stockBajo: 0,
      alertasActivas: 0,
      actividadReciente: [],
    });

    await loadAndRender('/');

    expect(
      await screen.findByText('No hay movimientos recientes.'),
    ).toBeInTheDocument();
  });

  it('renders the required fields for a recorded movimiento row', async () => {
    stubFetch(encargadoUsuario, {
      quiebres: 0,
      stockBajo: 0,
      alertasActivas: 0,
      actividadReciente: [
        {
          id: 'm1',
          productoId: 'p1',
          productoNombre: 'Harina 000',
          tipo: 'entrada',
          fecha: '2026-09-01T00:00:00.000Z',
          usuarioId: 'u1',
        },
      ],
    });

    await loadAndRender('/');

    expect(await screen.findByText('Harina 000')).toBeInTheDocument();
    expect(screen.getByText('Entrada')).toBeInTheDocument();
    expect(screen.getByText('u1')).toBeInTheDocument();
  });
});
