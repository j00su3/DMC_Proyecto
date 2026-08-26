import { Outlet, createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root.js';

/** Pathless layout for unauthenticated routes (login). No guard. */
export const publicLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'publicLayout',
  component: Outlet,
});
