import { createRoute } from '@tanstack/react-router';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import { StatusChip } from '../components/ui/StatusChip.js';
import { UsuarioForm } from '../features/usuarios/UsuarioForm.js';
import { usuariosErrorMessage } from '../features/usuarios/errorMessages.js';
import { formatFecha } from '../features/usuarios/format.js';
import { useActualizarUsuario } from '../features/usuarios/useActualizarUsuario.js';
import { useUsuario } from '../features/usuarios/useUsuario.js';
import { encargadoLayout } from './encargadoLayout.js';

/**
 * Detail route (usuarios-ui / Detail Screen and Edit User Flow): the
 * detail's fields ARE the edit form (D5) — no separate `/editar` route.
 * `rol` locks (disabled, visible reason) on the logged-in user's own
 * account per D17, extended by the corrected spec to cover `rol`.
 */
export const usuariosDetalleRoute = createRoute({
  getParentRoute: () => encargadoLayout,
  path: '/usuarios/$id',
  component: UsuariosDetalleScreen,
});

function UsuariosDetalleScreen() {
  const { id } = usuariosDetalleRoute.useParams();
  const sesion = usuariosDetalleRoute.useRouteContext().usuario;
  const query = useUsuario(id);
  const actualizar = useActualizarUsuario(id);

  if (query.isError) {
    const message = isApiError(query.error)
      ? usuariosErrorMessage(query.error)
      : 'Ocurrió un error inesperado. Intente de nuevo.';
    return (
      <div>
        <h1>Usuario</h1>
        <FormError message={message} />
      </div>
    );
  }

  if (!query.data) {
    return <h1>Usuario</h1>;
  }

  const { usuario } = query.data;

  return (
    <div>
      <h1>{usuario.nombre}</h1>
      <StatusChip
        activo={usuario.activo}
        debeCambiarPassword={usuario.debeCambiarPassword}
      />
      <p>Creado: {formatFecha(usuario.creadoEn)}</p>

      {actualizar.isError ? (
        <FormError
          message={
            isApiError(actualizar.error)
              ? usuariosErrorMessage(actualizar.error)
              : 'Ocurrió un error inesperado. Intente de nuevo.'
          }
        />
      ) : null}

      <UsuarioForm
        usuario={usuario}
        isOwnAccount={sesion.id === id}
        isPending={actualizar.isPending}
        onSubmit={(patch) => actualizar.mutate(patch)}
      />
    </div>
  );
}
