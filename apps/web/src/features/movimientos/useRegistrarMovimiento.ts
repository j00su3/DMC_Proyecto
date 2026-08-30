import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { productosKeys } from '../productos/queries.js';
import { movimientosKeys } from './queries.js';

type EntradaInput =
  paths['/api/productos/{id}/movimientos/entrada']['post']['requestBody']['content']['application/json'];
type SalidaInput =
  paths['/api/productos/{id}/movimientos/salida']['post']['requestBody']['content']['application/json'];
type AjusteInput =
  paths['/api/productos/{id}/movimientos/ajuste']['post']['requestBody']['content']['application/json'];

type EntradaResponse =
  paths['/api/productos/{id}/movimientos/entrada']['post']['responses']['201']['content']['application/json'];
type SalidaResponse =
  paths['/api/productos/{id}/movimientos/salida']['post']['responses']['201']['content']['application/json'];
type AjusteResponse =
  paths['/api/productos/{id}/movimientos/ajuste']['post']['responses']['201']['content']['application/json'];

/**
 * Three thin wrappers — one per `routes/movimientos.ts` (S4) write
 * endpoint, since each carries a genuinely distinct body shape
 * (`entrada`: `{ cantidad, motivo? }`; `salida`: `+ esMerma`; `ajuste`:
 * `+ direccion, esDiscrepancia`, per D7's table). A single mutation
 * parameterized by `operacion` would need to union all three bodies and
 * re-narrow at every call site — these wrappers do that narrowing once.
 *
 * Follows `features/productos/queries.ts`'s invalidate-never-`setQueryData`
 * rule: on success, invalidate this product's movement list AND its
 * `productosKeys.detail(id)` (the response carries the updated
 * `stockActual`, but the route/component layer re-fetches rather than this
 * hook writing the cache directly — S7b/S8 wire the actual UI).
 */
export function useRegistrarMovimiento(productoId: string) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: movimientosKeys.lists(),
      }),
      queryClient.invalidateQueries({
        queryKey: productosKeys.detail(productoId),
      }),
    ]);
  };

  const entrada = useMutation({
    mutationFn: (input: EntradaInput) =>
      apiFetch<EntradaResponse>(
        `/productos/${productoId}/movimientos/entrada`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      ),
    onSuccess: invalidate,
  });

  const salida = useMutation({
    mutationFn: (input: SalidaInput) =>
      apiFetch<SalidaResponse>(`/productos/${productoId}/movimientos/salida`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });

  const ajuste = useMutation({
    mutationFn: (input: AjusteInput) =>
      apiFetch<AjusteResponse>(`/productos/${productoId}/movimientos/ajuste`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });

  return { entrada, salida, ajuste };
}
