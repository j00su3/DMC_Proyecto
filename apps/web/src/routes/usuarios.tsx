import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { encargadoLayout } from './encargadoLayout.js';

/**
 * Clamps rather than throws (D6): `?page` is one hand-edit away, and a
 * route that throws on a malformed value is a blank screen. Only `page`
 * lives in the URL — `pageSize` is a module constant matched to the
 * server's default and has no picker in this change.
 */
const usuariosSearchSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((n) => Math.max(1, n)),
});

/**
 * Stub route for this PR (S2): no data fetch, no table. The list screen
 * itself ships in a later slice of this change — this route only proves
 * the guard, the search contract, and the nav destination exist.
 */
export const usuariosListRoute = createRoute({
  getParentRoute: () => encargadoLayout,
  path: '/usuarios',
  validateSearch: usuariosSearchSchema,
  component: UsuariosListStub,
});

function UsuariosListStub() {
  return <h1>Usuarios</h1>;
}
