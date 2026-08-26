import { createRoute } from '@tanstack/react-router';
import { authLayout } from './authLayout.js';

/**
 * Barest placeholder — the change-password form and its forced-change
 * redirect branch ship in Phase 6 (S6). Child of `authLayout` directly,
 * NOT of `shellLayout` (5A.11), so it stays reachable while
 * `debeCambiarPassword` is `true`.
 */
export const cambiarPasswordRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/cambiar-password',
  component: CambiarPasswordPlaceholder,
});

function CambiarPasswordPlaceholder() {
  return <div>Cambiar contraseña (placeholder — Phase 6)</div>;
}
