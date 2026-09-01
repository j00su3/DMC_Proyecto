import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import type { paths } from '../../api/schema.js';
import { productosKeys } from '../productos/queries.js';

type ConfirmarVentaInput =
  paths['/api/ventas']['post']['requestBody']['content']['application/json'];
export type ConfirmarVentaResponse =
  paths['/api/ventas']['post']['responses']['201']['content']['application/json'];
/** The confirmed sale record, per PD-10's success screen (correlativo +
 * total) and the "Ver recibo" link target (`id`). */
export type VentaConfirmada = ConfirmarVentaResponse['venta'];

/**
 * `POST /api/ventas`. On success (design.md's Data Flow): empty the cart
 * (PD-9) and invalidate `productosKeys.all` — the sale changed stock for
 * every sold product, and re-fetching (not `setQueryData`) is this
 * project's rule (`features/productos/queries.ts`'s invalidate-never-
 * `setQueryData` note).
 *
 * `vaciarCarrito` is injected rather than imported, because this hook does
 * not own the cart's state — `useCarrito` does, and only the component
 * composing both (PR8's `pos.tsx`) can hand this mutation the live
 * `vaciar` callback from its own `useCarrito` instance.
 *
 * On error — in particular `PRICE_CHANGED` (D5/D6/PD-6) — `onSuccess` never
 * runs: the cart is left exactly as the cashier had it, so the caller can
 * re-render the mismatched lines and resubmit with corrected
 * `precioUnitarioEsperado` values. "The sale stays open" is this absence of
 * a side effect, not a flag this hook sets.
 */
export function useConfirmarVenta(vaciarCarrito: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ConfirmarVentaInput) =>
      apiFetch<ConfirmarVentaResponse>('/ventas', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      vaciarCarrito();
      await queryClient.invalidateQueries({ queryKey: productosKeys.all });
    },
  });
}
