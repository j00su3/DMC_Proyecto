import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
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

function buildReciboResponse(estado: 'confirmada' | 'anulada' = 'confirmada') {
  return {
    venta: {
      id: VENTA_ID,
      numeroCorrelativo: 42,
      usuarioId: 'usr-1',
      estado,
      total: '150.00',
      creadoEn: '2026-08-31T15:30:00.000Z',
      anuladaPor: estado === 'anulada' ? 'usr-1' : null,
      anuladaEn: estado === 'anulada' ? '2026-09-01T10:00:00.000Z' : null,
      motivoAnulacion: estado === 'anulada' ? 'Cliente se retractó' : null,
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
}

const RECIBO_RESPONSE = buildReciboResponse('confirmada');

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stubFetch({
  usuario,
  ventaExists = true,
  ventaEstado = 'confirmada',
  anularResult,
}: {
  usuario: typeof encargadoUsuario | typeof depositoUsuario;
  ventaExists?: boolean;
  ventaEstado?: 'confirmada' | 'anulada';
  /** When set, `POST .../anular` resolves with this instead of the default
   * 200 success — lets a test assert the conflict-mapping path. */
  anularResult?: { status: number; body: unknown };
}) {
  // Mutable so a successful `POST .../anular` is reflected on the GET the
  // route's `reciboKeys.detail(id)` invalidation triggers afterward —
  // mirrors the real API's state transition, not a fixed fixture.
  let currentEstado: 'confirmada' | 'anulada' = ventaEstado;

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/auth/me')) return ok(200, { usuario });

      if (url.includes(`/api/ventas/${VENTA_ID}/anular`)) {
        if (anularResult) {
          return ok(anularResult.status, anularResult.body);
        }
        currentEstado = 'anulada';
        return ok(200, buildReciboResponse('anulada'));
      }

      if (url.includes(`/api/ventas/${VENTA_ID}`)) {
        if (!ventaExists) {
          return ok(404, {
            error: {
              code: 'SALE_NOT_FOUND',
              message: 'No se encontró la venta.',
            },
          });
        }
        return ok(200, buildReciboResponse(currentEstado));
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
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

  /** recibo-ui / Anulación Entry Point On The Venta/Receipt View (PD-3,
   * backlog #9), route-level scenarios. `Recibo.tsx` itself is NOT touched
   * (PD-4) — the trigger and modal live only in this route component. */
  describe('anulación entry point (backlog #9)', () => {
    it('shows the anulación trigger for an encargado on a confirmada venta', async () => {
      stubFetch({ usuario: encargadoUsuario, ventaEstado: 'confirmada' });
      await loadAndRenderRecibo();

      expect(
        await screen.findByRole('button', { name: 'Anular venta' }),
      ).toBeInTheDocument();
    });

    it('does not show the anulación trigger for a deposito session', async () => {
      stubFetch({ usuario: depositoUsuario, ventaEstado: 'confirmada' });
      await loadAndRenderRecibo();

      await screen.findByText('Martillo');
      expect(
        screen.queryByRole('button', { name: 'Anular venta' }),
      ).not.toBeInTheDocument();
    });

    it('does not show the anulación trigger for an already-anulada venta', async () => {
      stubFetch({ usuario: encargadoUsuario, ventaEstado: 'anulada' });
      await loadAndRenderRecibo();

      await screen.findByText('Martillo');
      expect(
        screen.queryByRole('button', { name: 'Anular venta' }),
      ).not.toBeInTheDocument();
    });

    it('does not fire the anulación request when the modal is submitted without a motivo', async () => {
      stubFetch({ usuario: encargadoUsuario, ventaEstado: 'confirmada' });
      const user = userEvent.setup();
      await loadAndRenderRecibo();

      await user.click(
        await screen.findByRole('button', { name: 'Anular venta' }),
      );
      const dialog = within(screen.getByRole('dialog'));
      await user.click(dialog.getByRole('button', { name: 'Anular venta' }));

      const fetchMock = vi.mocked(fetch);
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes('/anular'),
        ),
      ).toBe(false);
    });

    it('reflects estado = anulada via the existing plain-text field after a successful anulación, no new banner introduced', async () => {
      stubFetch({ usuario: encargadoUsuario, ventaEstado: 'confirmada' });
      const user = userEvent.setup();
      await loadAndRenderRecibo();

      await user.click(
        await screen.findByRole('button', { name: 'Anular venta' }),
      );
      const dialog = within(screen.getByRole('dialog'));
      await user.type(
        dialog.getByRole('textbox', { name: /motivo/i }),
        'Cliente se retractó del pago',
      );
      await user.click(dialog.getByRole('button', { name: 'Anular venta' }));

      expect(await screen.findByText('anulada')).toBeInTheDocument();
      expect(screen.queryByText('confirmada')).not.toBeInTheDocument();
    });

    it('maps a SALE_ALREADY_VOIDED conflict to its copy without closing the modal', async () => {
      stubFetch({
        usuario: encargadoUsuario,
        ventaEstado: 'confirmada',
        anularResult: {
          status: 409,
          body: {
            error: {
              code: 'SALE_ALREADY_VOIDED',
              message: 'Ya anulada.',
            },
          },
        },
      });
      const user = userEvent.setup();
      await loadAndRenderRecibo();

      await user.click(
        await screen.findByRole('button', { name: 'Anular venta' }),
      );
      const dialog = within(screen.getByRole('dialog'));
      await user.type(
        dialog.getByRole('textbox', { name: /motivo/i }),
        'Cliente se retractó del pago',
      );
      await user.click(dialog.getByRole('button', { name: 'Anular venta' }));

      expect(
        await screen.findByText('Esta venta ya fue anulada.'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('textbox', { name: /motivo/i }),
      ).toBeInTheDocument();
    });
  });
});
