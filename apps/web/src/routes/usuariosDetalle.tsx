import { createRoute } from '@tanstack/react-router';
import { encargadoLayout } from './encargadoLayout.js';

/**
 * Stub route for this PR (S2). The read-only profile render ships in S5a;
 * the edit form and the `rol` self-lock ship in S5b.
 */
export const usuariosDetalleRoute = createRoute({
  getParentRoute: () => encargadoLayout,
  path: '/usuarios/$id',
  component: UsuariosDetalleStub,
});

function UsuariosDetalleStub() {
  const { id } = usuariosDetalleRoute.useParams();
  return <h1>Usuario {id}</h1>;
}
