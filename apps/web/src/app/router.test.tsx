import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routes/routeTree.js';

function buildTestRouter(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({ routeTree, context: { queryClient }, history });
  return { router, queryClient };
}

/**
 * `RouterProvider` alone is enough for guard-only tests, but any screen that
 * uses a react-query hook (e.g. `useLogin`/`useLogout` inside route
 * components) needs the same `QueryClient` available via context too — the
 * real app gets this from `AppProviders`.
 */
function renderRouter(
  router: ReturnType<typeof buildTestRouter>['router'],
  queryClient: QueryClient,
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('app router', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects / to /ingresar when there is no session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: 'UNAUTHORIZED', message: 'No autorizado' },
        }),
      }),
    );

    const { router, queryClient } = buildTestRouter('/');
    renderRouter(router, queryClient);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/ingresar'),
    );
  });

  it('redirects / to /cambiar-password when the session must change its password, and / stays unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          usuario: {
            id: '1',
            nombre: 'Ana',
            email: 'ana@test.com',
            rol: 'encargado',
            debeCambiarPassword: true,
          },
        }),
      }),
    );

    const { router, queryClient } = buildTestRouter('/');
    renderRouter(router, queryClient);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/cambiar-password'),
    );
    expect(router.state.location.pathname).not.toBe('/');
  });

  const usuario = {
    id: '1',
    nombre: 'Ana',
    email: 'encargado@tienda.com',
    rol: 'encargado' as const,
    debeCambiarPassword: false,
  };

  function stubFetchForLogin(
    loginResponse: () => {
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    },
  ) {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: async () => ({
              error: { code: 'UNAUTHORIZED', message: 'No autorizado' },
            }),
          });
        }
        if (url.includes('/api/auth/login')) {
          return Promise.resolve(loginResponse());
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  }

  it('submitting valid credentials populates the session and navigates into the shell', async () => {
    const user = userEvent.setup();
    stubFetchForLogin(() => ({
      ok: true,
      status: 200,
      json: async () => ({ usuario }),
    }));

    const { router, queryClient } = buildTestRouter('/ingresar');
    renderRouter(router, queryClient);

    await user.type(
      await screen.findByLabelText('Correo electrónico'),
      'encargado@tienda.com',
    );
    await user.type(screen.getByLabelText('Contraseña'), 'secreto123');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByText('Ana')).toBeInTheDocument();
  });

  it('keeps the user on /ingresar with an error message for wrong credentials', async () => {
    const user = userEvent.setup();
    stubFetchForLogin(() => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        },
      }),
    }));

    const { router, queryClient } = buildTestRouter('/ingresar');
    renderRouter(router, queryClient);

    await user.type(
      await screen.findByLabelText('Correo electrónico'),
      'encargado@tienda.com',
    );
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(
      await screen.findByText(
        'El correo o la contraseña son incorrectos. Verifique los datos e intente de nuevo.',
      ),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/ingresar');
  });

  it('shows the retryAfter-derived message for a locked account', async () => {
    const user = userEvent.setup();
    stubFetchForLogin(() => ({
      ok: false,
      status: 423,
      json: async () => ({
        error: {
          code: 'ACCOUNT_LOCKED',
          message: 'Account is temporarily locked',
          details: { retryAfter: 120 },
        },
      }),
    }));

    const { router, queryClient } = buildTestRouter('/ingresar');
    renderRouter(router, queryClient);

    await user.type(
      await screen.findByLabelText('Correo electrónico'),
      'encargado@tienda.com',
    );
    await user.type(screen.getByLabelText('Contraseña'), 'secreto123');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(
      await screen.findByText(
        'La cuenta está bloqueada temporalmente. Intente de nuevo en 2 minutos.',
      ),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/ingresar');
  });
});
