import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { isApiError } from '../../api/errors.js';
import type { paths } from '../../api/schema.js';
import { usuariosKeys } from './queries.js';

type EstadoResponse =
  paths['/api/usuarios/{id}/deactivate']['post']['responses']['200']['content']['application/json'];

/**
 * `apiFetch` is called with NO `body` key at all — "Two corrections" in
 * `tasks.md`: the merged `apiFetch` fix (`api/client.ts:55-64`) already gates
 * `Content-Type` on `init.body !== undefined`, so `JSON.stringify({})` (the
 * design doc's original hedge) is unnecessary and would send a body neither
 * route declares a schema for.
 *
 * D9 (uniform rule): never `setQueryData`. D10's invalidation map: both
 * `deactivate` and `reactivate` invalidate `lists()` + `detail(id)` on
 * success. A `LAST_ACTIVE_ENCARGADO` failure on deactivate also invalidates
 * `lists()` — the refusal is direct evidence the client's picture of who is
 * an active encargado is wrong.
 */
/**
 * Target id is a mutate-time argument, not a hook-creation argument: the
 * list screen holds one instance of this hook and dispatches it against
 * whichever row's button was clicked, instead of instantiating a mutation
 * per row.
 */
function useEstadoMutation(segment: 'deactivate' | 'reactivate') {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<EstadoResponse>(`/usuarios/${id}/${segment}`, {
        method: 'POST',
      }),
    onSuccess: async (_data, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: usuariosKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: usuariosKeys.detail(id) }),
      ]);
    },
    onError: async (error) => {
      if (isApiError(error) && error.code === 'LAST_ACTIVE_ENCARGADO') {
        await queryClient.invalidateQueries({ queryKey: usuariosKeys.lists() });
      }
    },
  });
}

export function useEstadoUsuario() {
  return {
    deactivate: useEstadoMutation('deactivate'),
    reactivate: useEstadoMutation('reactivate'),
  };
}
