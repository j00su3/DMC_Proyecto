import { createRoute, redirect } from '@tanstack/react-router';
import { sessionQueryOptions } from '../api/session.js';
import { isApiError } from '../api/errors.js';
import { loginErrorMessage } from '../features/auth/errorMessages.js';
import { LoginForm } from '../features/auth/LoginForm.js';
import { useLogin } from '../features/auth/useLogin.js';
import { publicLayout } from './publicLayout.js';

/**
 * A logged-in user should never sit on the login screen: an already
 * authenticated visit bounces to `/`, and `shellLayout`'s guard takes it
 * from there (to `/cambiar-password` when the flag is set).
 */
export const ingresarRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: '/ingresar',
  beforeLoad: async ({ context }) => {
    const usuario =
      await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (usuario) {
      throw redirect({ to: '/' });
    }
  },
  component: IngresarScreen,
});

function IngresarScreen() {
  const login = useLogin();

  return (
    <LoginForm
      onSubmit={(values) => login.mutate(values)}
      isPending={login.isPending}
      errorMessage={
        login.error && isApiError(login.error)
          ? loginErrorMessage(login.error)
          : undefined
      }
    />
  );
}
