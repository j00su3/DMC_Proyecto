import type { ApiError } from '../../api/errors.js';

/**
 * Narrows `ApiError.details` for `PAYMENT_BELOW_TOTAL` only (D12,
 * `{ total, pagado }` — both decimal strings, never parsed to a number
 * here per D1: this is display text, not arithmetic).
 */
function paymentBelowTotalDetails(
  details: unknown,
): { total: string; pagado: string } | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const { total, pagado } = details as { total?: unknown; pagado?: unknown };
  return typeof total === 'string' && typeof pagado === 'string'
    ? { total, pagado }
    : undefined;
}

/**
 * Narrows `ApiError.details` for `INSUFFICIENT_STOCK`, same shape as
 * `features/movimientos/errorMessages.ts`'s helper — `available` is the
 * ENGLISH key the server emits (RECONCILE-1 reuses the code unchanged).
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
 * never `error.status`. Covers every RECONCILE-1 code `POST /api/ventas`
 * can emit (`tasks.md` Phase 6, task 6.1) plus the shared `VALIDATION_ERROR`
 * / `FORBIDDEN` fallbacks every route in this project emits.
 *
 * `PRICE_CHANGED`'s per-line detail (`{ items: [{ productoId,
 * precioEsperado, precioActual }] }`) is deliberately NOT itemized into
 * text here — that per-line re-confirmation UI belongs to PR8's
 * `PagoPanel`/`CarritoPanel`, which reads `error.details` directly. This
 * mapper only supplies the banner-level fallback message.
 */
export function posErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'PRICE_CHANGED':
      return 'Uno o más precios cambiaron. Revise el carrito y confirme nuevamente.';
    case 'PAYMENT_BELOW_TOTAL': {
      const details = paymentBelowTotalDetails(error.details);
      return details === undefined
        ? 'El monto pagado es menor al total de la venta.'
        : `El monto pagado ($${details.pagado}) es menor al total ($${details.total}).`;
    }
    case 'CASHLESS_PAYMENT_MUST_MATCH_TOTAL':
      return 'Los pagos con tarjeta, transferencia o QR deben coincidir exactamente con el total.';
    case 'PAYMENT_MEDIUM_DUPLICATED':
      return 'No puede repetir el mismo medio de pago más de una vez.';
    case 'DUPLICATE_SALE_ITEM':
      return 'Un producto está repetido en el carrito. Quite la línea duplicada e intente de nuevo.';
    case 'SALE_AMOUNT_OUT_OF_RANGE':
      return 'El monto de la venta es demasiado grande para procesar.';
    case 'INSUFFICIENT_STOCK': {
      const details = insufficientStockDetails(error.details);
      return details === undefined
        ? 'Stock insuficiente para completar la venta.'
        : `Stock insuficiente: hay ${details.available} disponibles.`;
    }
    case 'PRODUCT_NOT_FOUND':
      return 'No se encontró uno de los productos del carrito.';
    case 'PRODUCT_INACTIVE':
      return 'Uno de los productos del carrito está inactivo y no puede venderse.';
    case 'VALIDATION_ERROR':
      return 'Revise los datos ingresados e intente de nuevo.';
    case 'FORBIDDEN':
      return 'No tiene permiso para realizar esta acción.';
    default:
      return 'Ocurrió un error inesperado. Intente de nuevo.';
  }
}
