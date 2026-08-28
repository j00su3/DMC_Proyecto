import { createRoute } from '@tanstack/react-router';
import { encargadoLayout } from './encargadoLayout.js';

/**
 * Stub route for this PR (S2). The create form, `useCrearUsuario` and the
 * credential handoff ship in a later slice (S6b) of this change.
 */
export const usuariosNuevoRoute = createRoute({
  getParentRoute: () => encargadoLayout,
  path: '/usuarios/nuevo',
  component: UsuariosNuevoStub,
});

function UsuariosNuevoStub() {
  return <h1>Crear usuario</h1>;
}
