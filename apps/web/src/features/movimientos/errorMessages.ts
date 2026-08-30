import type { ApiError } from '../../api/errors.js';

/**
 * Narrows `ApiError.details` for `INSUFFICIENT_STOCK` only
 * (`apps/web/src/api/errors.ts:12-13`). `available` is the ENGLISH key the
 * server emits — RECONCILE-1, not `disponible`.
 */
function insufficientStockDetails(
  details: unknown,
): { available: number } | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const { available } = details as { available?: unknown };
  return typeof available === 'number' ? { available } : undefined;
}

/**
 * Pure `(ApiError) => string` mapper, following
 * `features/productos/errorMessages.ts`'s shape. Switches on `error.code`,
 * never `error.status`.
 *
 * Maps the six codes `routes/movimientos.ts` actually emits — NOT the two
 * originally proposed in spec.md (`ADJUSTMENT_RESERVED_FOR_ENCARGADO`,
 * `ADJUSTMENT_QUANTITY_ZERO`), neither of which S4 ever produces. See
 * task 6.1's correction note in tasks.md.
 */
export function movimientosErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'FORBIDDEN':
      return 'No tiene permiso para realizar esta acción.';
    case 'MOVEMENT_REASON_REQUIRED':
      return 'Ingrese un motivo para este movimiento.';
    case 'VALIDATION_ERROR':
      return 'Revise los datos ingresados e intente de nuevo.';
    case 'PRODUCT_NOT_FOUND':
      return 'No se encontró el producto solicitado.';
    case 'PRODUCT_INACTIVE':
      return 'El producto está inactivo y no admite movimientos.';
    case 'INSUFFICIENT_STOCK': {
      // ADR-0006's "Stock insuficiente: hay N" reaching the screen.
      const details = insufficientStockDetails(error.details);
      return details === undefined
        ? 'Stock insuficiente para este movimiento.'
        : `Stock insuficiente: hay ${details.available} disponibles.`;
    }
    default:
      return 'Ocurrió un error inesperado. Intente de nuevo.';
  }
}
