import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { apiFetch } from '../../api/client.js';
import type { Usuario } from '../../api/session.js';
import type { paths } from '../../api/schema.js';
import type { LoginInput } from './schemas.js';

type LoginResponse =
  paths['/api/auth/login']['post']['responses']['200']['content']['application/json'];

/**
 * Container for the login screen — owns the mutation and navigation, unlike
 * `LoginForm` (presentational). The router and query client come from
 * context rather than the module singletons for the same reason as
 * `useLogout`: importing `../../app/router.js` here would close an import
 * cycle.
 */
export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: LoginInput) =>
      apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: async ({ usuario }: { usuario: Usuario }) => {
      queryClient.setQueryData(['session'], usuario);
      await router.invalidate();
      await router.navigate({ to: '/' });
    },
  });
}
