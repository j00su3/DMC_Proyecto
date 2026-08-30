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
  data: [
    { id: 'prov-1', nombre: 'Proveedor Activo', activo: true },
    { id: 'prov-2', nombre: 'Proveedor Inactivo', activo: false },
  ],
  page: 1,
  pageSize: 100,
  total: 2,
};
const PRODUCTO_STUB = { id: 'prod-1', nombre: 'x', sku: 'x', activo: true };
type FetchHandlers = {
  usuario: typeof depositoUsuario | typeof encargadoUsuario;
  onPost?: (body: unknown) => { status: number; body: unknown };
};
function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stubFetch({ usuario, onPost }: FetchHandlers) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) return ok(200, { usuario });
      if (url.includes('/api/proveedores')) return ok(200, proveedoresResponse);
      if (url.includes('/api/productos') && init?.method === 'POST') {
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        const result = onPost
          ? onPost(body)
          : { status: 201, body: { producto: PRODUCTO_STUB } };
        return ok(result.status, result.body);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function loadAndRenderProductosNuevo() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = createMemoryHistory({
    initialEntries: ['/inventario/nuevo'],
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

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Nombre'), 'Martillo');
  await user.type(screen.getByLabelText('SKU'), 'SKU-001');
  await user.type(screen.getByLabelText('Precio'), '10.00');
  await screen.findByRole('option', { name: 'Proveedor Activo' });
  await user.selectOptions(
    screen.getByLabelText('Proveedor'),
    'Proveedor Activo',
  );
}

/** productos-ui / Create/Edit Form... (create half). Route-level, not just hook-level. */
describe('productosNuevo route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders stock_minimo visible, disabled, with a 🔒 indicator for a deposito session', async () => {
    stubFetch({ usuario: depositoUsuario });
    await loadAndRenderProductosNuevo();

    const stockMinimoField = await screen.findByLabelText('Stock mínimo');
    expect(stockMinimoField).toBeDisabled();
    // AppShell also renders locked nav items with 🔒 — scope to the field's own row.
    const fieldWrapper = stockMinimoField.closest('div') as HTMLElement;
    const lockNote = fieldWrapper.nextElementSibling as HTMLElement;
    expect(within(lockNote).getByText('🔒')).toBeInTheDocument();
  });

  it('allows an encargado to edit stock_minimo, offering only active suppliers', async () => {
    stubFetch({ usuario: encargadoUsuario });
    const user = userEvent.setup();
    await loadAndRenderProductosNuevo();

    const stockMinimoField = await screen.findByLabelText('Stock mínimo');
    expect(stockMinimoField).toBeEnabled();
    await user.type(stockMinimoField, '5');
    expect(stockMinimoField).toHaveValue('5');

    await screen.findByRole('option', { name: 'Proveedor Activo' });
    expect(
      screen.queryByRole('option', { name: 'Proveedor Inactivo' }),
    ).not.toBeInTheDocument();
  });

  it('sends a value > 0 in the initial-stock field as stockInicial on POST /api/productos', async () => {
    let capturedBody: unknown;
    stubFetch({
      usuario: encargadoUsuario,
      onPost: (body) => {
        capturedBody = body;
        return { status: 201, body: { producto: PRODUCTO_STUB } };
      },
    });
    const user = userEvent.setup();
    await loadAndRenderProductosNuevo();

    await fillRequiredFields(user);
    await user.type(screen.getByLabelText('Stock inicial'), '5');
    await user.click(screen.getByRole('button', { name: 'Crear producto' }));

    await waitFor(() =>
      expect(capturedBody).toMatchObject({ stockInicial: 5 }),
    );
  });

  it('renders the SKU_ALREADY_IN_USE mapped message inline, not a generic error', async () => {
    stubFetch({
      usuario: encargadoUsuario,
      onPost: () => ({
        status: 409,
        body: { error: { code: 'SKU_ALREADY_IN_USE', message: 'sku in use' } },
      }),
    });
    const user = userEvent.setup();
    await loadAndRenderProductosNuevo();

    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: 'Crear producto' }));

    expect(
      await screen.findByText('Ese SKU ya está en uso por otro producto.'),
    ).toBeInTheDocument();
  });
});
