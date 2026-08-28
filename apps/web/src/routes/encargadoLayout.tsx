import { Outlet, createRoute, redirect } from '@tanstack/react-router';
import { shellLayout } from './shellLayout.js';

/**
 * Role guard for the Usuarios routes, nested under `shellLayout` so the
 * client evaluates session -> forced-change -> role, the same order the
 * server enforces (401 -> 403 PASSWORD_CHANGE_REQUIRED -> 403 FORBIDDEN).
 *
 * This is UX convenience only, NOT the enforcement mechanism — exactly the
 * same disclaimer as `shellLayout.tsx`'s forced-change guard. The backend
 * returns `403 FORBIDDEN` on every user-management route regardless of
 * whether this guard ran, and that response is the actual security
 * boundary. A hidden or redirected route on the client MUST NOT be
 * documented, treated, or relied upon as access control — see
 * usuarios-ui/spec.md's "Encargado-Only Route Guard Is UX Convenience, Not
 * Access Control" requirement.
 */
export const encargadoLayout = createRoute({
  getParentRoute: () => shellLayout,
  id: 'encargadoLayout',
  beforeLoad: ({ context }) => {
    if (context.usuario.rol !== 'encargado') {
      throw redirect({ to: '/' });
    }
  },
  component: Outlet,
});
