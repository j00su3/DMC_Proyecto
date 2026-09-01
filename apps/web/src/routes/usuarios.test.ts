import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SIZE } from '../features/usuarios/queries.js';
import { routeTree } from './routeTree.js';

const encargadoUsuario = {
  id: '1',
  nombre: 'Ana',
  email: 'ana@test.com',
  rol: 'encargado' as const,
  debeCambiarPassword: false,
};

function buildAuthenticatedRouter(initialPath: string) {
  return buildAuthenticatedRouterWithQueryClient(initialPath).router;
}

function buildAuthenticatedRouterWithQueryClient(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({ routeTree, context: { queryClient }, history });
  return { router, queryClient };
}

function stubFetchAsEncargado() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ usuario: encargadoUsuario }),
    }),
  );
}

function usuarioRow(id: string) {
  return {
    id,
    nombre: `Usuario ${id}`,
    email: `u${id}@test.com`,
    rol: 'deposito' as const,
    activo: true,
    debeCambiarPassword: false,
    creadoEn: '2026-01-01T12:00:00.000Z',
  };
}

function stubFetchAsEncargadoWithList(listResponse: {
  data: ReturnType<typeof usuarioRow>[];
  page: number;
  pageSize: number;
  total: number;
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ usuario: encargadoUsuario }),
        });
      }
      if (url.includes('/api/usuarios')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => listResponse,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

/**
 * P2/P3 (design.md Testing Strategy) — route structure and resolution
 * exercised programmatically against the real, registered `routeTree`, the
 * same tree `app/router.test.tsx` renders through `RouterProvider`. No
 * rendering is needed here: `router.load()` resolves `beforeLoad` and
 * `validateSearch` for every matched route the same way navigation does.
 */
describe('usuarios routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves /usuarios/nuevo to the create route, not /usuarios/$id with id "nuevo" (D5)', async () => {
    stubFetchAsEncargado();
    const router = buildAuthenticatedRouter('/usuarios/nuevo');
    await router.load();

    expect(router.state.location.pathname).toBe('/usuarios/nuevo');
    const matchedIds = router.state.matches.map((match) => match.routeId);
    expect(matchedIds).toContain(
      '/authLayout/shellLayout/encargadoLayout/usuarios/nuevo',
    );
    expect(matchedIds).not.toContain(
      '/authLayout/shellLayout/encargadoLayout/usuarios/$id',
    );
  });

  it('clamps a non-numeric ?page to 1 without throwing (D6)', async () => {
    stubFetchAsEncargado();
    const router = buildAuthenticatedRouter('/usuarios?page=abc');
    await router.load();

    expect(router.state.location.pathname).toBe('/usuarios');
    const listMatch = router.state.matches.find(
      (match) =>
        match.routeId === '/authLayout/shellLayout/encargadoLayout/usuarios',
    );
    expect(listMatch?.search).toEqual({ page: 1 });
  });

  it('clamps a negative ?page to 1 without throwing (D6)', async () => {
    stubFetchAsEncargado();
    const router = buildAuthenticatedRouter('/usuarios?page=-4');
    await router.load();

    expect(router.state.location.pathname).toBe('/usuarios');
    const listMatch = router.state.matches.find(
      (match) =>
        match.routeId === '/authLayout/shellLayout/encargadoLayout/usuarios',
    );
    expect(listMatch?.search).toEqual({ page: 1 });
  });

  it('resolves /usuarios/:id to the detail route with the id in params', async () => {
    stubFetchAsEncargado();
    const router = buildAuthenticatedRouter('/usuarios/42');
    await router.load();

    expect(router.state.location.pathname).toBe('/usuarios/42');
    const matchedIds = router.state.matches.map((match) => match.routeId);
    expect(matchedIds).toContain(
      '/authLayout/shellLayout/encargadoLayout/usuarios/$id',
    );
  });

  it('corrects an out-of-range page: settled data.length===0 && total>0 && page>1 navigates to the last real page, replacing history (D11)', async () => {
    stubFetchAsEncargadoWithList({
      data: [],
      page: 9,
      pageSize: PAGE_SIZE,
      total: 3,
    });
    const router = buildAuthenticatedRouter('/usuarios?page=9');
    await router.load();

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ page: 1 }),
    );
    expect(router.state.location.pathname).toBe('/usuarios');
  });

  it('does not navigate when total===0 (no non-empty page to recover to)', async () => {
    stubFetchAsEncargadoWithList({
      data: [],
      page: 1,
      pageSize: PAGE_SIZE,
      total: 0,
    });
    const router = buildAuthenticatedRouter('/usuarios?page=1');
    await router.load();

    expect(router.state.location.search).toEqual({ page: 1 });
  });

  it('renders a link to /usuarios/nuevo — the create route existed with zero entry point from this list', async () => {
    stubFetchAsEncargadoWithList({
      data: [usuarioRow('1')],
      page: 1,
      pageSize: PAGE_SIZE,
      total: 1,
    });
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios');

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    expect(
      await screen.findByRole('link', { name: 'Crear usuario' }),
    ).toHaveAttribute('href', '/usuarios/nuevo');
  });

  it('renders the empty state when total===0, not a blank/errored table', async () => {
    stubFetchAsEncargadoWithList({
      data: [],
      page: 1,
      pageSize: PAGE_SIZE,
      total: 0,
    });
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios');

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    expect(
      await screen.findByText('No hay usuarios registrados.'),
    ).toBeInTheDocument();
  });

  /**
   * usuarios-ui / Last-Active-Encargado Guard Is Server-Authoritative — the
   * control was enabled beforehand (no client-side prediction anywhere in
   * this change) and the error surfaces only after the 409 response.
   */
  it('surfaces LAST_ACTIVE_ENCARGADO copy after a refused deactivate; the control was enabled beforehand', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ usuario: encargadoUsuario }),
          });
        }
        if (init?.method === 'POST' && url.includes('/deactivate')) {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({
              error: {
                code: 'LAST_ACTIVE_ENCARGADO',
                message:
                  'No se puede desactivar: es el último encargado activo.',
              },
            }),
          });
        }
        if (url.includes('/api/usuarios')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: [usuarioRow('7')],
              page: 1,
              pageSize: PAGE_SIZE,
              total: 1,
            }),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios');
    await router.load();

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    const desactivar = await screen.findByRole('button', {
      name: 'Desactivar',
    });
    expect(desactivar).toBeEnabled();

    await user.click(desactivar);

    expect(
      await screen.findByText(/último encargado activo/i),
    ).toBeInTheDocument();
  });

  /**
   * usuarios-ui / Admin Password-Reset Flow + Temporary Password Handling —
   * reuses `CredentialDialog` (D12/D13/D14) for the reset flow, exactly as
   * for create: the plaintext hands off to the modal, and acknowledging it
   * dismisses the dialog.
   */
  it('shows the CredentialDialog with the one-time plaintext after a password-reset, dismissed by acknowledging', async () => {
    const user = userEvent.setup();
    const PLAINTEXT = 'QK4R-8MB2-VC9H-TN7X';
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ usuario: encargadoUsuario }),
          });
        }
        if (init?.method === 'POST' && url.includes('/password-reset')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              usuario: { ...usuarioRow('7'), debeCambiarPassword: true },
              passwordTemporal: PLAINTEXT.replace(/-/g, ''),
            }),
          });
        }
        if (url.includes('/api/usuarios')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: [usuarioRow('7')],
              page: 1,
              pageSize: PAGE_SIZE,
              total: 1,
            }),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios');
    await router.load();

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    await user.click(
      await screen.findByRole('button', { name: 'Restablecer contraseña' }),
    );

    expect(
      await screen.findByRole('dialog', {
        name: 'Contraseña temporal generada',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(PLAINTEXT)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Entendido' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });
  /**
   * usuarios-ui / Deactivate And Reactivate Actions — the success path.
   *
   * `useEstadoUsuario.test.ts` proves the request shape and that
   * `invalidateQueries` is called, but a called invalidation is not a
   * visible update: nothing there renders the table. This test stubs a real
   * 200, lets the list refetch, and asserts the chip the encargado is
   * actually looking at changes — the same "proven at the wrong layer" gap
   * that let `POST /api/auth/logout` ship broken behind three green tests.
   */
  it('flips the row chip to Inactivo after a successful deactivate', async () => {
    const user = userEvent.setup();
    let activo = true;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ usuario: encargadoUsuario }),
          });
        }
        if (init?.method === 'POST' && url.includes('/deactivate')) {
          activo = false;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              usuario: { ...usuarioRow('7'), activo: false },
            }),
          });
        }
        if (url.includes('/api/usuarios')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ ...usuarioRow('7'), activo }],
              page: 1,
              pageSize: PAGE_SIZE,
              total: 1,
            }),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios');
    await router.load();

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    expect(await screen.findByText('Activo')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Desactivar' }));

    expect(await screen.findByText('Inactivo')).toBeInTheDocument();
    expect(screen.queryByText('Activo')).not.toBeInTheDocument();
  });

  /**
   * usuarios-ui / List Screen With Pagination — the footer must be derived
   * from the server's envelope, not from hand-fed props.
   * `Pagination.test.tsx` covers the component in isolation; only a route
   * test proves the screen turns `total` and `pageSize` into the right page
   * count. A wrong derivation (using `data.length`, or dropping the ceiling)
   * would pass every existing test.
   */
  it('derives the pagination footer from the envelope total, not from the rows on screen', async () => {
    stubFetchAsEncargadoWithList({
      data: [usuarioRow('7')],
      page: 1,
      pageSize: PAGE_SIZE,
      // 41 rows over a page size of 20 is three pages, and the last one is
      // partial — a floor instead of a ceiling would lose it.
      total: PAGE_SIZE * 2 + 1,
    });
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios');
    await router.load();

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    const footer = await screen.findByRole('navigation', {
      name: 'Paginación',
    });
    expect(within(footer).getByRole('button', { name: '1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(footer).getByRole('button', { name: '3' }),
    ).toBeInTheDocument();
    expect(within(footer).queryByRole('button', { name: '4' })).toBeNull();
    expect(
      within(footer).getByRole('button', { name: 'Anterior' }),
    ).toBeDisabled();
    expect(
      within(footer).getByRole('button', { name: 'Siguiente' }),
    ).toBeEnabled();
  });
});
