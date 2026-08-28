import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import type { Usuario } from '../../api/session.js';
import { usuariosKeys } from './queries.js';
import type { ActualizarUsuarioInput } from './schemas.js';

type UpdateResponse =
  paths['/api/usuarios/{id}']['patch']['responses']['200']['content']['application/json'];

/**
 * PATCH from `formState.dirtyFields` (D18): the caller (`UsuarioForm`'s
 * wiring) builds `patch` from only what actually changed, never the full
 * triple — an empty body is a 400 `VALIDATION_ERROR` since
 * `actualizarUsuarioBody` is `.strict().refine(keys > 0)`.
 *
 * D9 (uniform rule): never `setQueryData`. D10's invalidation map: `lists()`
 * and `detail(id)` always; `['session']` additionally when the PATCH target
 * is the logged-in user — otherwise `AppShell`'s sidebar user card keeps a
 * stale name/rol until a reload.
 */
export function useActualizarUsuario(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: ActualizarUsuarioInput) =>
      apiFetch<UpdateResponse>(`/usuarios/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: async () => {
      const session = queryClient.getQueryData<Usuario | null>(['session']);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: usuariosKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: usuariosKeys.detail(id) }),
        session?.id === id
          ? queryClient.invalidateQueries({ queryKey: ['session'] })
          : Promise.resolve(),
      ]);
    },
  });
}
