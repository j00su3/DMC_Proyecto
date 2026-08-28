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

const PLAINTEXT = 'XK7T9QM4BN2CVR8H';

const encargadoUsuario = {
  id: '1',
  nombre: 'Ana',
  email: 'ana@test.com',
  rol: 'encargado' as const,
  debeCambiarPassword: false,
};

function buildAuthenticatedRouterWithQueryClient(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({ routeTree, context: { queryClient }, history });
  return { router, queryClient };
}

function stubFetchAsEncargadoCreating() {
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
      if (init?.method === 'POST' && url.includes('/api/usuarios')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            usuario: {
              id: '9',
              nombre: 'Carla',
              email: 'carla@test.com',
              rol: 'deposito',
              activo: true,
              debeCambiarPassword: true,
              creadoEn: '2026-01-01T12:00:00.000Z',
            },
            passwordTemporal: PLAINTEXT,
          }),
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

/**
 * P3 (design.md Testing Strategy) — usuarios-ui / Create User Flow: valid,
 * unique data submits to `POST /api/usuarios`; the 201 response's one-time
 * plaintext hands off to `CredentialDialog`, never rendered inline in the
 * form.
 */
describe('usuariosNuevoRoute', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits valid data and hands the temporary password to the credential dialog, not inline in the form', async () => {
    const user = userEvent.setup();
    stubFetchAsEncargadoCreating();
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios/nuevo');
    await router.load();

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    await user.type(await screen.findByLabelText('Nombre'), 'Carla');
    await user.type(screen.getByLabelText('Correo'), 'carla@test.com');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    expect(
      await screen.findByRole('dialog', {
        name: 'Contraseña temporal generada',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('XK7T-9QM4-BN2C-VR8H')).toBeInTheDocument();

    const form = document.querySelector('form');
    expect(form?.textContent ?? '').not.toContain(PLAINTEXT);
  });

  it('acknowledging the dialog navigates to /usuarios', async () => {
    const user = userEvent.setup();
    stubFetchAsEncargadoCreating();
    const { router, queryClient } =
      buildAuthenticatedRouterWithQueryClient('/usuarios/nuevo');
    await router.load();

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );

    await user.type(await screen.findByLabelText('Nombre'), 'Carla');
    await user.type(screen.getByLabelText('Correo'), 'carla@test.com');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    await user.click(await screen.findByRole('button', { name: 'Entendido' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/usuarios'),
    );
  });
});
