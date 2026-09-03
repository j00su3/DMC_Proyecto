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

type AlertaRow = {
  id: string;
  productoId: string;
  productoNombre: string;
  tipo: string;
  estado: string;
  movimientoId: string;
  creadaEn: string;
  resueltaEn: string | null;
  resueltaPor: string | null;
};

const discrepanciaRow: AlertaRow = {
  id: 'a1',
  productoId: 'p1',
  productoNombre: 'Azúcar 1kg',
  tipo: 'discrepancia',
  estado: 'activa',
  movimientoId: 'm1',
  creadaEn: '2026-09-01T00:00:00.000Z',
  resueltaEn: null,
  resueltaPor: null,
};

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stubFetch({
  usuario,
  alertas = [discrepanciaRow],
  abiertas = alertas.filter((a) => a.estado === 'activa').length,
}: {
  usuario: typeof depositoUsuario | typeof encargadoUsuario;
  alertas?: (typeof discrepanciaRow)[];
  abiertas?: number;
}) {
  // Stateful list (`productosDetalle.test.tsx` precedent): a resolve
  // mutation must actually flip the row's estado in what a refetch returns,
  // or "the list reflects resuelta after the request succeeds" is decorative.
  const rows = alertas.map((a) => ({ ...a }));

  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/api/auth/me')) return ok(200, { usuario });

      if (url.includes('/api/alertas/marcar-vistas') && method === 'POST') {
        return ok(200, { marcadas: 0 });
      }

      if (/\/api\/alertas\/[^/]+\/resolver$/.test(url) && method === 'POST') {
        const id = url.split('/').at(-2);
        const row = rows.find((r) => r.id === id);
        if (row) {
          row.estado = 'resuelta';
          row.resueltaEn = '2026-09-02T00:00:00.000Z';
          row.resueltaPor = usuario.id;
        }
        return ok(200, { alerta: row });
      }

      if (url.includes('/api/alertas/conteo')) {
        return ok(200, {
          abiertas: rows.filter((r) => r.estado === 'activa').length,
        });
      }

      if (url.includes('/api/alertas')) {
        return ok(200, {
          data: [...rows],
          page: 1,
          pageSize: 20,
          total: rows.length,
        });
      }

      throw new Error(`unexpected fetch: ${url}`);
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function loadAndRenderAlertas(initialPath: string) {
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

/**
 * alertas-ui route wiring (task 4.9). Route-level coverage, not just
 * hook/component level (house rule) — `await router.load()` before every
 * render.
 */
describe('alertas route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('deposito reaches /alertas and sees the list, not a permission refusal', async () => {
    stubFetch({ usuario: depositoUsuario });
    const router = await loadAndRenderAlertas('/alertas');

    expect(router.state.location.pathname).toBe('/alertas');
    expect(await screen.findByText('Azúcar 1kg')).toBeInTheDocument();
  });

  it('deposito sees no resolve control on a discrepancia row', async () => {
    stubFetch({ usuario: depositoUsuario });
    await loadAndRenderAlertas('/alertas');

    await screen.findByText('Azúcar 1kg');
    expect(
      screen.queryByRole('button', { name: 'Resolver' }),
    ).not.toBeInTheDocument();
  });

  it('encargado resolving updates the list to resuelta', async () => {
    const user = userEvent.setup();
    stubFetch({ usuario: encargadoUsuario });
    await loadAndRenderAlertas('/alertas');

    await user.click(await screen.findByRole('button', { name: 'Resolver' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Resolver' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('marks alerts as vistas once on mount (route effect, not a user action)', async () => {
    const fetchMock = stubFetch({ usuario: depositoUsuario });
    await loadAndRenderAlertas('/alertas');

    await screen.findByText('Azúcar 1kg');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) =>
          String(c[0]).includes('/api/alertas/marcar-vistas'),
        ),
      ).toHaveLength(1),
    );
  });

  /**
   * Fake timers must be active BEFORE `useQuery`'s `refetchInterval` sets
   * up its `setTimeout` — switching to fake timers AFTER mount leaves that
   * interval scheduled against the REAL clock, so `advanceTimersByTimeAsync`
   * never fires it. `vi.advanceTimersByTimeAsync(0)` after each render step
   * flushes the microtask-resolved fetch stub without needing real time.
   */
  it('the AppShell badge issues a new /alertas/conteo request after 60 seconds elapse', async () => {
    const fetchMock = stubFetch({ usuario: encargadoUsuario });
    vi.useFakeTimers();

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const history = createMemoryHistory({ initialEntries: ['/alertas'] });
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history,
    });
    const loadPromise = router.load();
    await vi.advanceTimersByTimeAsync(0);
    await loadPromise;
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('Azúcar 1kg')).toBeInTheDocument();

    const conteoCallsBefore = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/alertas/conteo'),
    ).length;

    await vi.advanceTimersByTimeAsync(60_000);

    const conteoCallsAfter = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/alertas/conteo'),
    ).length;
    expect(conteoCallsAfter).toBeGreaterThan(conteoCallsBefore);
  });
});
