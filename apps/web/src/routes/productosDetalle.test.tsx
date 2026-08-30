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

type FetchHandlers = {
  usuario: typeof depositoUsuario | typeof encargadoUsuario;
  onPatch?: (body: unknown) => { status: number; body: unknown };
  onDeactivate?: () => { status: number; body: unknown };
};

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stubFetch({ usuario, onPatch, onDeactivate }: FetchHandlers) {
  // Stateful `activo`, not a fixed stub: the deactivate mutation invalidates
  // rather than `setQueryData`s (D9's uniform rule), so the "row's chip
  // updates from the response" scenario is only provable if the refetch
  // this test's `waitFor` observes actually reflects the mutation.
  let activo = true;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) return ok(200, { usuario });
      if (url.includes('/api/proveedores')) return ok(200, proveedoresResponse);
      if (url.includes('/api/productos/prod-1/deactivate')) {
        activo = false;
        const result = onDeactivate
          ? onDeactivate()
          : { status: 200, body: { producto: { ...PRODUCTO_DETAIL, activo } } };
        return ok(result.status, result.body);
      }
      if (url.includes('/api/productos/prod-1') && init?.method === 'PATCH') {
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        const result = onPatch
          ? onPatch(body)
          : { status: 200, body: { producto: PRODUCTO_DETAIL } };
        return ok(result.status, result.body);
      }
      if (url.includes('/api/productos/prod-1')) {
        return ok(200, { producto: { ...PRODUCTO_DETAIL, activo } });
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
