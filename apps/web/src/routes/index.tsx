import { createRoute } from '@tanstack/react-router';
import { shellLayout } from './shellLayout.js';

export const indexRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/',
  component: PanelGeneral,
});

function PanelGeneral() {
  return (
    <>
      <h1>Panel general</h1>
      <p>Placeholder shell — Phase 5A (S5a). Screens ship in later seams.</p>
    </>
  );
}
