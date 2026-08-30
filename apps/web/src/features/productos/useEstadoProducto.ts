import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { productosKeys } from './queries.js';

type EstadoResponse =
  paths['/api/productos/{id}/deactivate']['post']['responses']['200']['content']['application/json'];

/**
 * Mirrors `features/usuarios/useEstadoUsuario.ts` — no `body` key at all
 * (both routes take none), invalidates `lists()` + `detail(id)` on success
 * so the row's chip updates from the response without a full reload
 * (productos-ui / Deactivate/Reactivate Controls).
 */
function useEstadoMutation(segment: 'deactivate' | 'reactivate') {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<EstadoResponse>(`/productos/${id}/${segment}`, {
        method: 'POST',
      }),
    onSuccess: async (_data, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productosKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: productosKeys.detail(id) }),
      ]);
    },
  });
}

export function useEstadoProducto() {
  return {
    deactivate: useEstadoMutation('deactivate'),
    reactivate: useEstadoMutation('reactivate'),
  };
}
