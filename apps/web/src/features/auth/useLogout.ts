import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { apiFetch } from '../../api/client.js';

/**
 * Logs out and redirects to `/ingresar` regardless of the response outcome
 * (5A.13) — a failed logout call must not strand the user in a shell they
 * can no longer use.
 *
 * The router and query client come from context rather than the module
 * singletons on purpose: importing `../../app/router.js` here would close an
 * import cycle (router -> routeTree -> index -> useLogout -> router). That
 * cycle happens to work today only because `router` is read inside the
 * callback rather than at module scope, which is far too subtle to rely on.
 */
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>('/auth/logout', { method: 'POST' }),
    onSettled: async () => {
      queryClient.setQueryData(['session'], null);
      await router.invalidate();
      await router.navigate({ to: '/ingresar' });
    },
  });
}
