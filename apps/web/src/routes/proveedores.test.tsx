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

const PROVEEDOR_ACTIVO = {
  id: '11111111-1111-4111-8111-111111111111',
  nombre: 'Acme Insumos',
  contacto: 'ana@acme.com',
  activo: true,
  creadoEn: '2026-01-15T12:00:00.000Z',
};

const UNRESOLVABLE_UUID = '99999999-9999-4999-8999-999999999999';

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stubFetch({
  usuario,
  proveedores = [PROVEEDOR_ACTIVO],
  onCreate,
}: {
  usuario: typeof depositoUsuario | typeof encargadoUsuario;
  proveedores?: (typeof PROVEEDOR_ACTIVO)[];
  onCreate?: (body: unknown) => { status: number; body: unknown };
}) {
  // Stateful list (`productosDetalle.test.tsx` precedent, "not a fixed
  // stub"): every mutation here invalidates rather than `setQueryData`, so a
  // refetch must actually reflect a prior POST for "the screen updates
  // without a manual reload" to be a real assertion, not a decorative one.
  const rows = [...proveedores];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/api/auth/me')) return ok(200, { usuario });

      if (url.includes('/api/proveedores') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const result = onCreate
          ? onCreate(body)
          : {
              status: 201,
              body: {
                proveedor: {
                  id: '22222222-2222-4222-8222-222222222222',
                  nombre: typeof body.nombre === 'string' ? body.nombre : '',
                  contacto: body.contacto ?? null,
                  activo: true,
                  creadoEn: '2026-02-01T00:00:00.000Z',
                },
              },
            };
        if (result.status < 400) {
          const created = (result.body as { proveedor?: unknown }).proveedor;
          if (created) rows.push(created as (typeof proveedores)[number]);
        }
        return ok(result.status, result.body);
      }

      if (url.includes('/api/proveedores')) {
        return ok(200, {
          data: [...rows],
          page: 1,
          pageSize: 100,
          total: rows.length,
        });
      }

      if (url.includes('/api/productos')) {
        return ok(200, { data: [], page: 1, pageSize: 20, total: 0 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function loadAndRenderProveedores(initialPath: string) {
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
 * proveedores-ui route wiring. Route-level coverage, not just hook/component
 * level (house rule) — `await router.load()` before every render.
 */
describe('proveedores route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deep link with a valid ?selected=<uuid> resolves that supplier's detail", async () => {
    stubFetch({ usuario: encargadoUsuario });
    await loadAndRenderProveedores(
      `/proveedores?selected=${PROVEEDOR_ACTIVO.id}`,
    );

    expect(
      await screen.findByRole('heading', { name: 'Acme Insumos' }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('ana@acme.com')).toBeInTheDocument();
  });

  it('a well-formed but unresolvable uuid shows the distinct not-found state, not the placeholder (PD-2)', async () => {
    stubFetch({ usuario: encargadoUsuario });
    await loadAndRenderProveedores(
      `/proveedores?selected=${UNRESOLVABLE_UUID}`,
    );

    await screen.findByRole('heading', { name: 'Proveedores' });
    expect(
      screen.getByText(/no se encontró el proveedor/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Seleccione un proveedor de la lista para ver su detalle.',
      ),
    ).not.toBeInTheDocument();
  });

  it('no ?selected shows the empty/nothing-selected placeholder', async () => {
    stubFetch({ usuario: encargadoUsuario });
    await loadAndRenderProveedores('/proveedores');

    expect(
      await screen.findByText(
        'Seleccione un proveedor de la lista para ver su detalle.',
      ),
    ).toBeInTheDocument();
  });

  it('deposito sees no write affordance: read-only fields and no create trigger', async () => {
    stubFetch({ usuario: depositoUsuario });
    await loadAndRenderProveedores(
      `/proveedores?selected=${PROVEEDOR_ACTIVO.id}`,
    );

    await screen.findByRole('heading', { name: 'Acme Insumos' });
    expect(screen.queryAllByRole('textbox')).toHaveLength(1); // only the search filter input
    expect(
      screen.queryByRole('button', { name: 'Crear proveedor nuevo' }),
    ).not.toBeInTheDocument();
  });

  it('a successful create selects the new row', async () => {
    stubFetch({ usuario: encargadoUsuario });
    const user = userEvent.setup();
    const router = await loadAndRenderProveedores('/proveedores');

    await user.click(
      await screen.findByRole('button', { name: 'Crear proveedor nuevo' }),
    );
    await user.type(screen.getByLabelText('Nombre'), 'Nuevo Proveedor');
    await user.click(screen.getByRole('button', { name: 'Crear proveedor' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        selected: '22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(
      await screen.findByDisplayValue('Nuevo Proveedor'),
    ).toBeInTheDocument();
  });

  it('the AppShell nav entry reaches /proveedores', async () => {
    stubFetch({ usuario: encargadoUsuario });
    const user = userEvent.setup();
    await loadAndRenderProveedores('/inventario');

    await user.click(await screen.findByRole('link', { name: 'Proveedores' }));

    await screen.findByRole('heading', { name: 'Proveedores' });
  });
});
