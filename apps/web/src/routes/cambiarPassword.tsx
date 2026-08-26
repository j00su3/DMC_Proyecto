import { createRoute } from '@tanstack/react-router';
import { isApiError } from '../api/errors.js';
import { ChangePasswordForm } from '../features/auth/ChangePasswordForm.js';
import { useChangePassword } from '../features/auth/useChangePassword.js';
import { authLayout } from './authLayout.js';

/**
 * Child of `authLayout` directly, NOT of `shellLayout` (5A.11), so it stays
 * reachable while `debeCambiarPassword` is `true` — otherwise a flagged user
 * would bounce forever and could never clear the flag. No `beforeLoad` of
 * its own: `authLayout`'s session guard is the only guard that applies here.
 */
export const cambiarPasswordRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/cambiar-password',
  component: CambiarPasswordScreen,
});

function CambiarPasswordScreen() {
  const changePassword = useChangePassword();
  const { error } = changePassword;

  return (
    <ChangePasswordForm
      onSubmit={(values) => changePassword.mutate(values)}
      isPending={changePassword.isPending}
      currentPasswordError={
        error && isApiError(error) && error.code === 'INVALID_CURRENT_PASSWORD'
          ? 'La contraseña actual es incorrecta.'
          : undefined
      }
    />
  );
}
