import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { productosKeys } from './queries.js';
import type { ActualizarProductoInput } from './schemas.js';

type UpdateResponse =
  paths['/api/productos/{id}']['patch']['responses']['200']['content']['application/json'];

/**
 * Mirrors `useCrearProducto.ts` (mutation + invalidate-never-`setQueryData`).
 * Invalidates both `lists()` and `detail(id)` — the row's chip and this
 * screen's own fields both read off those cache entries.
 */
export function useActualizarProducto(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ActualizarProductoInput) =>
      apiFetch<UpdateResponse>(`/productos/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productosKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: productosKeys.detail(id) }),
      ]);
    },
  });
}
