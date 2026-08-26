import { createRoute } from '@tanstack/react-router';
import { publicLayout } from './publicLayout.js';

/**
 * Barest placeholder — the login form, its submission and its error states
 * ship in Phase 5B (S5b). This route exists here only so the guards in this
 * seam have a real target to redirect to.
 */
export const ingresarRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: '/ingresar',
  component: IngresarPlaceholder,
});

function IngresarPlaceholder() {
  return <div>Ingresar (placeholder — Phase 5B)</div>;
}
