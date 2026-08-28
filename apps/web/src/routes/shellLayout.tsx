import { Outlet, createRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '../components/ui/AppShell.js';
import { useLogout } from '../features/auth/useLogout.js';
import { authLayout } from './authLayout.js';

/**
 * Forced-password-change client guard, nested under `authLayout`. This is
 * UX convenience only, NOT the enforcement mechanism — the server allowlist
 * shipped in Phase 3 (D2–D4) is the authority; this guard just spares a
 * flagged user an extra bounce.
 *
 * `cambiarPassword` (Phase 6) is a child of `authLayout` directly, NOT of
 * this layout, so it stays reachable while `debeCambiarPassword` is `true`
 * — otherwise this guard would redirect the user away from the very screen
 * that clears the flag.
 *
 * `component` mounts `AppShell` once around `<Outlet/>` (app-layout spec,
 * D1), so every child route — the home route and, from this PR on, the
 * usuarios routes — shares one persistent sidebar instance instead of each
 * re-rendering its own copy of it.
 */
export const shellLayout = createRoute({
  getParentRoute: () => authLayout,
  id: 'shellLayout',
  beforeLoad: ({ context }) => {
    if (context.usuario.debeCambiarPassword) {
      throw redirect({ to: '/cambiar-password' });
    }
  },
  component: ShellLayoutContainer,
});

function ShellLayoutContainer() {
  const usuario = shellLayout.useRouteContext().usuario;
  const logout = useLogout();

  return (
    <AppShell
      usuario={usuario}
      onLogout={() => logout.mutate()}
      isLoggingOut={logout.isPending}
    >
      <Outlet />
    </AppShell>
  );
}
