import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from './routeTree.js';

const encargadoUsuario = {
  id: '1',
  nombre: 'Ana',
  email: 'ana@test.com',
  rol: 'encargado' as const,
  debeCambiarPassword: false,
};

const otherUsuario = {
  id: '7',
  nombre: 'Beto',
  email: 'beto@test.com',
  rol: 'deposito' as const,
  activo: true,
  debeCambiarPassword: false,
  creadoEn: '2026-01-01T12:00:00.000Z',
};

function buildAuthenticatedRouterWithQueryClient(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({ routeTree, context: { queryClient }, history });
  return { router, queryClient };
}

type DetailUsuario = {
  id: string;
  nombre: string;
  email: string;
  rol: 'encargado' | 'deposito';
  activo: boolean;
  debeCambiarPassword: boolean;
  creadoEn: string;
};

function stubFetchAsEncargadoWithDetail(usuario: DetailUsuario) {
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
      if (url.includes('/api/usuarios/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ usuario }),
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

/**
 * P3 (design.md Testing Strategy) — usuarios-ui / Detail Screen: navigating
 * to `/usuarios/:id` for an existing id renders that user's profile fields
 * with no password or hash field present anywhere in the rendered output.
 */
describe('usuariosDetalleRoute', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the profile fields for an existing id, with no password/hash field anywhere', async () => {
    stubFetchAsEncargadoWithDetail(otherUsuario);
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios/7');
    await router.load();

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    expect(await screen.findByText('Beto')).toBeInTheDocument();
    expect(screen.getByDisplayValue('beto@test.com')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/password/i);
    expect(document.body.textContent).not.toMatch(/hash/i);
  });

  it('renders rol enabled for another user, locked for the logged-in user own account (D17)', async () => {
    stubFetchAsEncargadoWithDetail(otherUsuario);
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios/7');
    await router.load();

    const otherRender = render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    expect(await screen.findByLabelText('Rol')).toBeEnabled();
    otherRender.unmount();

    stubFetchAsEncargadoWithDetail({
      ...encargadoUsuario,
      activo: true,
      creadoEn: '2026-01-01T12:00:00.000Z',
    });
    const { router: ownRouter, queryClient: ownQueryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios/1');
    await ownRouter.load();

    render(
      createElement(
        QueryClientProvider,
        { client: ownQueryClient },
        createElement(RouterProvider, { router: ownRouter }),
      ),
    );

    expect(await screen.findByLabelText('Rol')).toBeDisabled();
  });

  it('submits a PATCH with only the dirty fields and refetches the detail on success', async () => {
    const user = userEvent.setup();
    let patchBody: string | undefined;
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
        if (init?.method === 'PATCH') {
          patchBody = init.body as string;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              usuario: { ...otherUsuario, nombre: 'Nuevo nombre' },
            }),
          });
        }
        if (url.includes('/api/usuarios/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ usuario: otherUsuario }),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios/7');
    await router.load();

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    const nombreField = await screen.findByLabelText('Nombre');
    await user.clear(nombreField);
    await user.type(nombreField, 'Nuevo nombre');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(patchBody).toBe(JSON.stringify({ nombre: 'Nuevo nombre' })),
    );
  });

  /**
   * usuarios-ui / Self-Action Block Is A UI Affordance, Not An Authorization
   * Control (D17, extended): the logged-in user's own detail renders
   * deactivate/reactivate and password-reset disabled with a visible reason.
   * Another user's detail keeps both enabled.
   */
  it('renders deactivate and restablecer disabled with a reason on own detail, enabled on another user', async () => {
    stubFetchAsEncargadoWithDetail(otherUsuario);
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios/7');
    await router.load();

    const otherRender = render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    expect(
      await screen.findByRole('button', { name: 'Desactivar' }),
    ).toBeEnabled();
    otherRender.unmount();

    stubFetchAsEncargadoWithDetail({
      ...encargadoUsuario,
      activo: true,
      creadoEn: '2026-01-01T12:00:00.000Z',
    });
    const { router: ownRouter, queryClient: ownQueryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios/1');
    await ownRouter.load();

    render(
      createElement(
        QueryClientProvider,
        { client: ownQueryClient },
        createElement(RouterProvider, { router: ownRouter }),
      ),
    );

    expect(
      await screen.findByRole('button', { name: 'Desactivar' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Restablecer contraseña' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/no puede realizar esta acción sobre su propia cuenta/i),
    ).toBeInTheDocument();
  });

  it('surfaces LAST_ACTIVE_ENCARGADO copy after a refused deactivate on the detail screen', async () => {
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
        if (url.includes('/api/usuarios/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ usuario: otherUsuario }),
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios/7');
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
});
