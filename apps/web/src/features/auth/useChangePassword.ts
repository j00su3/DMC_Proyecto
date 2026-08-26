import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import type { ChangePasswordInput } from './schemas.js';

type ChangePasswordResponse =
  paths['/api/auth/password']['post']['responses']['200']['content']['application/json'];

/**
 * Container for the change-password screen — owns the mutation and
 * cache/navigation side effects, unlike `ChangePasswordForm` (presentational).
 * The router and query client come from context rather than the module
 * singletons for the same reason as `useLogin`/`useLogout`: importing
 * `../../app/router.js` here would close an import cycle.
 */
export function useChangePassword() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: ChangePasswordInput) =>
      apiFetch<ChangePasswordResponse>('/auth/password', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      // Merge, not replace: the rest of the cached Usuario (id, nombre,
      // email, rol) must survive — only the flag changes.
      queryClient.setQueryData(
        ['session'],
        (usuario: { debeCambiarPassword: boolean } | null | undefined) =>
          usuario ? { ...usuario, debeCambiarPassword: false } : usuario,
      );
      // Re-runs shellLayout's beforeLoad so the redirect clears immediately.
      await router.invalidate();
    },
  });
}
