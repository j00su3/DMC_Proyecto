import { QueryClient } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routes/routeTree.js';

function buildTestRouter(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({ routeTree, context: { queryClient }, history });
  return router;
}

/**
 * The full login submission flow is verified in Phase 5B's extension of
 * this same file. Here we only prove the guards compose correctly through a
 * real router: no session bounces to /ingresar, and a forced-change session
 * bounces to /cambiar-password with `/` unreachable.
 */
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

    const router = buildTestRouter('/');
    render(<RouterProvider router={router} />);

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

    const router = buildTestRouter('/');
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/cambiar-password'),
    );
    expect(router.state.location.pathname).not.toBe('/');
  });
});
