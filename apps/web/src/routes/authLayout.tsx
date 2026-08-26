import { Outlet, createRoute, redirect } from '@tanstack/react-router';
import { sessionQueryOptions } from '../api/session.js';
import { rootRoute } from './__root.js';

/**
 * Session-required pathless layout guard (D11) — the client mirror of the
 * server allowlist's "session required" half. Reads the session from the
 * react-query cache (D12) and resolves it (D13) before the protected UI
 * ever renders, so nothing flashes.
 */
export const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authLayout',
  beforeLoad: async ({ context }) => {
    const usuario =
      await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (!usuario) {
      throw redirect({ to: '/ingresar' });
    }
    return { usuario };
  },
  component: Outlet,
});
