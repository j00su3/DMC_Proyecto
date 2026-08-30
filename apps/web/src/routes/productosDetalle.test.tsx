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
const proveedoresResponse = {
  data: [{ id: 'prov-1', nombre: 'Proveedor Activo', activo: true }],
  page: 1,
  pageSize: 100,
  total: 1,
};
const PRODUCTO_DETAIL = {
  id: 'prod-1',
  nombre: 'Martillo',
  sku: 'SKU-1',
  categoria: 'Herramientas',
  stockActual: 10,
  stockMinimo: 3,
  precio: '10.00',
  proveedorId: 'prov-1',
  activo: true,
  creadoEn: '2024-01-01T00:00:00.000Z',
};

type MovimientoRow = {
  id: string;
  productoId: string;
  tipo: 'entrada' | 'salida' | 'ajuste';
  cantidad: number;
  motivo: string | null;
  esDiscrepancia: boolean;
  esMerma: boolean;
  usuarioId: string;
  fecha: string;
  ventaId: string | null;
  stockResultante: number;
};

type RegistrarResult = { status: number; body: unknown };

type FetchHandlers = {
  usuario: typeof depositoUsuario | typeof encargadoUsuario;
  producto?: typeof PRODUCTO_DETAIL;
  onPatch?: (body: unknown) => { status: number; body: unknown };
  onDeactivate?: () => { status: number; body: unknown };
  /** Seeds `GET .../movimientos` — newest-first, matching D4's ordering. */
  movimientosRows?: MovimientoRow[];
  /** Overrides the default entrada/salida/ajuste success wiring, e.g. to
   * simulate a server refusal (409 INSUFFICIENT_STOCK). */
  onRegistrarMovimiento?: (
    operacion: 'entrada' | 'salida' | 'ajuste',
    body: Record<string, unknown>,
  ) => RegistrarResult;
};

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stubFetch({
  usuario,
  producto = PRODUCTO_DETAIL,
  onPatch,
  onDeactivate,
  movimientosRows = [],
  onRegistrarMovimiento,
}: FetchHandlers) {
  // Stateful `activo`/`stockActual`/movement rows, not a fixed stub: both
  // the deactivate mutation and `useRegistrarMovimiento` invalidate rather
  // than `setQueryData` (the project's uniform rule), so "the screen
  // updates without a manual reload" is only provable if the refetch this
  // test observes actually reflects the mutation's effect.
  let activo = producto.activo;
  let stockActual = producto.stockActual;
  const rows = [...movimientosRows];
  let nextMovimientoId = rows.length + 1;

  function registrarDefault(
    operacion: 'entrada' | 'salida' | 'ajuste',
    body: Record<string, unknown>,
  ): RegistrarResult {
    const cantidad = Number(body.cantidad);
    const delta =
      operacion === 'entrada'
        ? cantidad
        : operacion === 'salida'
          ? -cantidad
          : body.direccion === 'restar'
            ? -cantidad
            : cantidad;
    stockActual += delta;
    const movimiento: MovimientoRow = {
      id: `mov-${nextMovimientoId++}`,
      productoId: producto.id,
      tipo: operacion,
      cantidad: delta,
      motivo: typeof body.motivo === 'string' ? body.motivo : null,
      esDiscrepancia: body.esDiscrepancia === true,
      esMerma: body.esMerma === true,
      usuarioId: usuario.id,
      fecha: new Date().toISOString(),
      ventaId: null,
      stockResultante: stockActual,
    };
    rows.unshift(movimiento);
    return {
      status: 201,
      body: {
        movimiento,
        producto: { ...producto, activo, stockActual },
      },
    };
  }

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/api/auth/me')) return ok(200, { usuario });
      if (url.includes('/api/proveedores')) return ok(200, proveedoresResponse);

      if (
        url.includes(`/api/productos/${producto.id}/movimientos/`) &&
        method === 'POST'
      ) {
        const operacion = url.endsWith('/entrada')
          ? 'entrada'
          : url.endsWith('/salida')
            ? 'salida'
            : 'ajuste';
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const result = onRegistrarMovimiento
          ? onRegistrarMovimiento(operacion, body)
          : registrarDefault(operacion, body);
        return ok(result.status, result.body);
      }

      if (
        url.includes(`/api/productos/${producto.id}/movimientos`) &&
        method === 'GET'
      ) {
        // A SNAPSHOT (`[...rows]`), never the live array reference: a real
        // HTTP response is serialized once at response time, so mutating
        // `rows` afterward (a later POST's `unshift`) must never reach
        // already-cached data by reference. Returning the live array here
        // would make "the list updates" pass on ANY unrelated re-render,
        // not on TanStack Query actually refetching — exactly the kind of
        // decorative pass this project's CLAUDE.md warns against.
        return ok(200, {
          data: [...rows],
          page: 1,
          pageSize: 20,
          total: rows.length,
        });
      }

      if (url.includes(`/api/productos/${producto.id}/deactivate`)) {
        activo = false;
        const result = onDeactivate
          ? onDeactivate()
          : { status: 200, body: { producto: { ...producto, activo } } };
        return ok(result.status, result.body);
      }
      if (url.includes(`/api/productos/${producto.id}`) && method === 'PATCH') {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        const result = onPatch
          ? onPatch(body)
          : { status: 200, body: { producto } };
        return ok(result.status, result.body);
      }
      if (url.includes(`/api/productos/${producto.id}`)) {
        return ok(200, { producto: { ...producto, activo, stockActual } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function loadAndRenderProductosDetalle() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = createMemoryHistory({
    initialEntries: ['/inventario/prod-1'],
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

/** productos-ui / Create/Edit Form (edit half) + Deactivate/Reactivate Controls. Route-level. */
describe('productosDetalle route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the edit form with no initial-stock input present', async () => {
    stubFetch({ usuario: encargadoUsuario });
    await loadAndRenderProductosDetalle();

    await screen.findByDisplayValue('Martillo');
    expect(screen.queryByLabelText('Stock inicial')).not.toBeInTheDocument();
  });

  it('updates the status chip from the response when an encargado deactivates, without a full reload', async () => {
    stubFetch({ usuario: encargadoUsuario });
    const user = userEvent.setup();
    await loadAndRenderProductosDetalle();

    await screen.findByDisplayValue('Martillo');
    expect(screen.getByText('Activo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Desactivar' }));

    expect(await screen.findByText('Inactivo')).toBeInTheDocument();
    expect(screen.queryByText('Activo')).not.toBeInTheDocument();
  });

  it('shows the deactivate control visible, disabled, with a 🔒 indicator for a deposito session', async () => {
    stubFetch({ usuario: depositoUsuario });
    await loadAndRenderProductosDetalle();

    const button = await screen.findByRole('button', { name: 'Desactivar' });
    expect(button).toBeDisabled();
    expect(button.nextElementSibling).toHaveTextContent('🔒');
  });

  /**
   * Same reasoning as `productosNuevo.test.tsx`'s equivalent test: the
   * server's guard on `stockMinimo` is key PRESENCE, not value, so a
   * deposito PATCH carrying `stockMinimo: null` 403s exactly as hard as
   * one carrying a number. Losing this branch would 403 every deposito
   * product edit in production while every other test here stayed green.
   */
  it('omits the stockMinimo key entirely from a deposito PATCH body', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    stubFetch({
      usuario: depositoUsuario,
      onPatch: (body) => {
        capturedBody = body as Record<string, unknown>;
        return { status: 200, body: { producto: PRODUCTO_DETAIL } };
      },
    });
    const user = userEvent.setup();
    await loadAndRenderProductosDetalle();

    await screen.findByDisplayValue('Martillo');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(capturedBody).toBeDefined());
    expect(Object.hasOwn(capturedBody ?? {}, 'stockMinimo')).toBe(false);
  });

  /**
   * D8, verbatim: a guard written against the stored row would make "every
   * edit of a product whose supplier was deactivated later start failing".
   * The server guard is written correctly — it keys off key PRESENCE in the
   * payload (`productos/service.ts:200`) — so sending `proveedorId` on every
   * PATCH reproduces that exact failure from the client instead. Renaming a
   * product whose supplier has since been deactivated would be refused with
   * SUPPLIER_INACTIVE, for a supplier the user never chose.
   */
  it('sends only the touched fields, omitting an untouched proveedorId', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    stubFetch({
      usuario: encargadoUsuario,
      onPatch: (body) => {
        capturedBody = body as Record<string, unknown>;
        return { status: 200, body: { producto: PRODUCTO_DETAIL } };
      },
    });
    const user = userEvent.setup();
    await loadAndRenderProductosDetalle();

    const nombre = await screen.findByDisplayValue('Martillo');
    await user.clear(nombre);
    await user.type(nombre, 'Martillo de carpintero');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(capturedBody).toBeDefined());
    expect(capturedBody).toEqual({ nombre: 'Martillo de carpintero' });
  });
});

function movimientoRow(overrides: Partial<MovimientoRow> = {}): MovimientoRow {
  return {
    id: 'mov-seed-1',
    productoId: PRODUCTO_DETAIL.id,
    tipo: 'salida',
    cantidad: -2,
    motivo: 'venta mostrador',
    esDiscrepancia: false,
    esMerma: false,
    usuarioId: '1',
    fecha: '2026-01-05T00:00:00.000Z',
    ventaId: null,
    stockResultante: 8,
    ...overrides,
  };
}

/** Walks the modal through an entrada flow (S7a/S7b) and submits at step 3. */
async function submitEntrada(
  user: ReturnType<typeof userEvent.setup>,
  cantidad: string,
) {
  // Scoped to the dialog: the page-level trigger and the modal's own
  // submit button share the exact label "Registrar movimiento".
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('radio', { name: 'Entrada' }));
  await user.click(within(dialog).getByRole('button', { name: 'Continuar' }));
  await user.type(
    within(dialog).getByLabelText('Cantidad a ingresar'),
    cantidad,
  );
  await user.click(within(dialog).getByRole('button', { name: 'Continuar' }));
  await user.click(
    within(dialog).getByRole('button', { name: 'Registrar movimiento' }),
  );
}

/**
 * S8: the trigger and history list on `productosDetalle` (movimientos-ui /
 * "The Modal Is Triggered From The Product Screen…", inventory-movements'
 * UI half of "Movement History Is Readable Per Product, Paginated").
 * Route-level, full `routeTree` + `createMemoryHistory`, `await
 * router.load()` before every render, per this project's house rule.
 */
describe('productosDetalle — movimientos trigger and history (S8)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the Registrar movimiento trigger, enabled, for an active product for an encargado', async () => {
    stubFetch({ usuario: encargadoUsuario });
    await loadAndRenderProductosDetalle();

    const trigger = await screen.findByRole('button', {
      name: 'Registrar movimiento',
    });
    expect(trigger).toBeEnabled();
  });

  it('shows the Registrar movimiento trigger, enabled, for an active product for a deposito', async () => {
    stubFetch({ usuario: depositoUsuario });
    await loadAndRenderProductosDetalle();

    const trigger = await screen.findByRole('button', {
      name: 'Registrar movimiento',
    });
    expect(trigger).toBeEnabled();
  });

  it('hides (not disables) the Registrar movimiento trigger for an inactive product, per D10', async () => {
    stubFetch({
      usuario: encargadoUsuario,
      producto: { ...PRODUCTO_DETAIL, activo: false },
    });
    await loadAndRenderProductosDetalle();

    await screen.findByDisplayValue('Martillo');
    expect(
      screen.queryByRole('button', { name: 'Registrar movimiento' }),
    ).not.toBeInTheDocument();
  });

  it('opens the modal, completes a successful entrada flow, closes the modal and shows the updated stock', async () => {
    stubFetch({ usuario: encargadoUsuario });
    const user = userEvent.setup();
    await loadAndRenderProductosDetalle();

    await screen.findByText('Stock actual: 10');
    await user.click(
      await screen.findByRole('button', { name: 'Registrar movimiento' }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await submitEntrada(user, '5');

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Stock actual: 15')).toBeInTheDocument();
  });

  it('renders the history list from GET .../movimientos, paginated', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      movimientoRow({ id: `mov-${i}`, motivo: `motivo ${i}` }),
    );
    stubFetch({ usuario: encargadoUsuario, movimientosRows: rows });
    await loadAndRenderProductosDetalle();

    await screen.findByText('motivo 0');
    expect(
      screen.getByRole('navigation', { name: 'Paginación' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
  });

  it('renders a merma row visually distinguishable from an ordinary salida', async () => {
    const rows = [
      movimientoRow({ id: 'mov-normal', esMerma: false, motivo: 'venta' }),
      movimientoRow({
        id: 'mov-merma',
        esMerma: true,
        motivo: 'rotura',
        cantidad: -1,
      }),
    ];
    stubFetch({ usuario: encargadoUsuario, movimientosRows: rows });
    await loadAndRenderProductosDetalle();

    await screen.findByText('venta');
    expect(screen.getAllByText('Merma')).toHaveLength(1);
  });

  /**
   * The half of task 8.1's owed assertion proving the SCREEN updates:
   * `useRegistrarMovimiento` invalidates `movimientosKeys.lists()`, which
   * only matches a `list()` key that keeps nesting under it (TanStack
   * Query's prefix-match invalidation). A regression here would leave every
   * registration succeeding, correctly written, while the table silently
   * keeps showing stale rows — the exact failure this project's CLAUDE.md
   * names as "route-level coverage, not just hook-level".
   */
  it('gains the new row in the history list after a successful registration, without a manual reload', async () => {
    stubFetch({ usuario: encargadoUsuario, movimientosRows: [] });
    const user = userEvent.setup();
    await loadAndRenderProductosDetalle();

    expect(screen.queryByText('Entrada')).not.toBeInTheDocument();

    await user.click(
      await screen.findByRole('button', { name: 'Registrar movimiento' }),
    );
    await submitEntrada(user, '5');

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Entrada')).toBeInTheDocument();
  });

  /**
   * The end-to-end proof owed by S8 (S7b's ownership note): a real `409
   * INSUFFICIENT_STOCK { details: { available: 5 } }` response becomes the
   * exact Spanish text a user reads, with the modal still open. This is
   * `useRegistrarMovimiento` + `movimientosErrorMessage`'s wiring, and
   * neither is exercised end to end anywhere else in this cycle.
   */
  it('surfaces a 409 INSUFFICIENT_STOCK server error as readable text, without closing the modal', async () => {
    stubFetch({
      usuario: encargadoUsuario,
      onRegistrarMovimiento: () => ({
        status: 409,
        body: {
          error: {
            code: 'INSUFFICIENT_STOCK',
            message: 'Stock insuficiente.',
            details: { available: 5 },
          },
        },
      }),
    });
    const user = userEvent.setup();
    await loadAndRenderProductosDetalle();

    await user.click(
      await screen.findByRole('button', { name: 'Registrar movimiento' }),
    );
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Salida' }));
    await user.click(within(dialog).getByRole('button', { name: 'Continuar' }));
    await user.type(within(dialog).getByLabelText('Cantidad a retirar'), '20');
    await user.click(within(dialog).getByRole('button', { name: 'Continuar' }));
    await user.click(
      within(dialog).getByRole('button', { name: 'Registrar movimiento' }),
    );

    expect(
      await screen.findByText('Stock insuficiente: hay 5 disponibles.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
