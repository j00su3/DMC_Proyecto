import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { productosKeys } from '../productos/queries.js';
import { reciboKeys } from './queries.js';

type AnularInput =
  paths['/api/ventas/{id}/anular']['post']['requestBody']['content']['application/json'];
type AnularResponse =
  paths['/api/ventas/{id}/anular']['post']['responses']['200']['content']['application/json'];

/**
 * `POST /api/ventas/:id/anular` mutation (design's Data Flow). On success,
 * invalidates `reciboKeys.detail(id)` (the receipt view re-fetches
 * `estado: 'anulada'`) AND `productosKeys.all` (the anulación reverses
 * stock for every item, so any product list/detail view holding stale
 * `stockActual` must refetch too) — mirrors
 * `useRegistrarMovimiento.ts`'s invalidate-never-`setQueryData` rule.
 */
export function useAnularVenta(ventaId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AnularInput) =>
      apiFetch<AnularResponse>(`/ventas/${ventaId}/anular`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: reciboKeys.detail(ventaId),
        }),
        queryClient.invalidateQueries({ queryKey: productosKeys.all }),
      ]);
    },
  });
}
