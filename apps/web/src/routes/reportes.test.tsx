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

function stubFetch(usuario: typeof depositoUsuario | typeof encargadoUsuario) {
  const productoRow = {
    id: 'p1',
    nombre: 'Harina 000',
    sku: 'HAR-000',
    categoria: 'Almacén',
    stockActual: 12,
    stockMinimo: 5,
    precio: '150.00',
    proveedorId: 'prov1',
    activo: true,
    creadoEn: '2026-09-01T00:00:00.000Z',
  };
  const discrepanciaRow = {
    id: 'd1',
    productoId: 'p1',
    productoNombre: 'Azúcar 1kg',
    tipo: 'discrepancia',
    estado: 'resuelta',
    movimientoId: 'm1',
    creadaEn: '2026-09-01T00:00:00.000Z',
    resueltaEn: '2026-09-02T00:00:00.000Z',
    resueltaPor: 'Ana Lopez',
  };
  const movimientoRow = {
    id: 'm1',
    productoId: 'p1',
    productoNombre: 'Harina 000',
    tipo: 'entrada',
    cantidad: 10,
    motivo: null,
    esDiscrepancia: false,
    esMerma: false,
    usuarioId: usuario.id,
    fecha: '2026-09-01T00:00:00.000Z',
    ventaId: null,
    stockResultante: 20,
  };

  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);

    if (url.includes('/api/auth/me')) return ok(200, { usuario });
    if (url.includes('/api/reportes/stock-actual')) {
      return ok(200, { data: [productoRow], page: 1, pageSize: 20, total: 1 });
    }
    if (url.includes('/api/reportes/bajo-minimo')) {
      return ok(200, { data: [productoRow], page: 1, pageSize: 20, total: 1 });
    }
    if (url.includes('/api/reportes/movimientos')) {
      return ok(200, {
        data: [movimientoRow],
        page: 1,
        pageSize: 20,
        total: 1,
      });
    }
    if (url.includes('/api/reportes/discrepancias')) {
      if (usuario.rol === 'deposito') {
        return ok(403, {
          error: { code: 'FORBIDDEN', message: 'Forbidden' },
        });
      }
      return ok(200, {
        data: [discrepanciaRow],
        page: 1,
        pageSize: 20,
        total: 1,
      });
    }

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

/**
 * Route registration (task 5.4): both-role reports under `shellLayout`,
 * discrepancias under `encargadoLayout` only. The discrepancias redirect is
 * a UX affordance only, exactly like `encargadoLayout.test.ts`'s Usuarios
 * precedent — the server's `403` (Phase 4) is the real boundary.
 */
describe('reportes routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deposito reaches /reportes/stock-actual and sees the report', async () => {
    stubFetch(depositoUsuario);
    const router = await loadAndRender('/reportes/stock-actual');

    expect(router.state.location.pathname).toBe('/reportes/stock-actual');
    expect(await screen.findByText('Harina 000')).toBeInTheDocument();
  });

  it('deposito reaches /reportes/bajo-minimo and sees the report', async () => {
    stubFetch(depositoUsuario);
    const router = await loadAndRender('/reportes/bajo-minimo');

    expect(router.state.location.pathname).toBe('/reportes/bajo-minimo');
    expect(await screen.findByText('Harina 000')).toBeInTheDocument();
  });

  it('deposito reaches /reportes/movimientos and sees only their own scope surfaced by the server', async () => {
    stubFetch(depositoUsuario);
    const router = await loadAndRender('/reportes/movimientos');

    expect(router.state.location.pathname).toBe('/reportes/movimientos');
    expect(await screen.findByText('Harina 000')).toBeInTheDocument();
  });

  it('deposito is redirected away from /reportes/discrepancias (UX affordance only — server 403 is the real boundary)', async () => {
    stubFetch(depositoUsuario);
    const router = await loadAndRender('/reportes/discrepancias');

    expect(router.state.location.pathname).toBe('/');
  });

  it('encargado reaches /reportes/discrepancias and sees resolution state', async () => {
    stubFetch(encargadoUsuario);
    const router = await loadAndRender('/reportes/discrepancias');

    expect(router.state.location.pathname).toBe('/reportes/discrepancias');
    expect(await screen.findByText('Azúcar 1kg')).toBeInTheDocument();
    // `getAllByText` — "Ana Lopez" also renders in the sidebar user card.
    expect(screen.getAllByText('Ana Lopez').length).toBeGreaterThanOrEqual(1);
  });
});
