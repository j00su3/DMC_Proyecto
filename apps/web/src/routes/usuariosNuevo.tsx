import { createRoute } from '@tanstack/react-router';
import { isApiError } from '../api/errors.js';
import { FormError } from '../components/ui/FormError.js';
import { CredentialDialog } from '../features/usuarios/CredentialDialog.js';
import { UsuarioForm } from '../features/usuarios/UsuarioForm.js';
import { usuariosErrorMessage } from '../features/usuarios/errorMessages.js';
import type { CrearUsuarioInput } from '../features/usuarios/schemas.js';
import { useCrearUsuario } from '../features/usuarios/useCrearUsuario.js';
import { encargadoLayout } from './encargadoLayout.js';

/**
 * Create route (usuarios-ui / Create User Flow). D12/D13/D14: the temporary
 * password from `POST /api/usuarios`'s `201` response is handed off to
 * `CredentialDialog`, never rendered inline in this form. Not visually
 * approved — see `docs/design.md`'s tokens (usuarios-ui / Design-Tokens-
 * Only Build, No Approved Mockup).
 */
export const usuariosNuevoRoute = createRoute({
  getParentRoute: () => encargadoLayout,
  path: '/usuarios/nuevo',
  component: UsuariosNuevoScreen,
});

const EMPTY_USUARIO = { nombre: '', email: '', rol: 'deposito' as const };

function UsuariosNuevoScreen() {
  const navigate = usuariosNuevoRoute.useNavigate();
  const crear = useCrearUsuario();

  function acknowledge() {
    crear.acknowledge();
    navigate({ to: '/usuarios', search: { page: 1 } });
  }

  return (
    <div>
      <h1>Crear usuario</h1>

      {crear.error ? (
        <FormError
          message={
            isApiError(crear.error)
              ? usuariosErrorMessage(crear.error)
              : 'Ocurrió un error inesperado. Intente de nuevo.'
          }
        />
      ) : null}

      <UsuarioForm
        usuario={EMPTY_USUARIO}
        isOwnAccount={false}
        mode="create"
        isPending={crear.isPending}
        onSubmit={(values) => crear.mutate(values as CrearUsuarioInput)}
      />

      {crear.credential ? (
        <CredentialDialog
          credential={crear.credential}
          onAcknowledge={acknowledge}
        />
      ) : null}
    </div>
  );
}
