import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors.js';
import { posErrorMessage } from './errorMessages.js';

describe('posErrorMessage', () => {
  it.each([
    [
      'PRICE_CHANGED',
      undefined,
      'Uno o más precios cambiaron. Revise el carrito y confirme nuevamente.',
    ],
    [
      'CASHLESS_PAYMENT_MUST_MATCH_TOTAL',
      undefined,
      'Los pagos con tarjeta, transferencia o QR deben coincidir exactamente con el total.',
    ],
    [
      'PAYMENT_MEDIUM_DUPLICATED',
      undefined,
      'No puede repetir el mismo medio de pago más de una vez.',
    ],
    [
      'DUPLICATE_SALE_ITEM',
      undefined,
      'Un producto está repetido en el carrito. Quite la línea duplicada e intente de nuevo.',
    ],
    [
      'SALE_AMOUNT_OUT_OF_RANGE',
      undefined,
      'El monto de la venta es demasiado grande para procesar.',
    ],
    [
      'PRODUCT_NOT_FOUND',
      undefined,
      'No se encontró uno de los productos del carrito.',
    ],
    [
      'PRODUCT_INACTIVE',
      undefined,
      'Uno de los productos del carrito está inactivo y no puede venderse.',
    ],
    [
      'VALIDATION_ERROR',
      undefined,
      'Revise los datos ingresados e intente de nuevo.',
    ],
    ['FORBIDDEN', undefined, 'No tiene permiso para realizar esta acción.'],
  ])('returns a distinct message for %s', (code, details, expected) => {
    expect(posErrorMessage(new ApiError(400, code, 'x', details))).toBe(
      expected,
    );
  });

  it('returns a distinct fallback message for an unknown code', () => {
    expect(posErrorMessage(new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(
      'Ocurrió un error inesperado. Intente de nuevo.',
    );
  });

  it('PAYMENT_BELOW_TOTAL falls back without details', () => {
    expect(posErrorMessage(new ApiError(409, 'PAYMENT_BELOW_TOTAL', 'x'))).toBe(
      'El monto pagado es menor al total de la venta.',
    );
  });

  it('PAYMENT_BELOW_TOTAL includes total and pagado from details', () => {
    expect(
      posErrorMessage(
        new ApiError(409, 'PAYMENT_BELOW_TOTAL', 'x', {
          total: '100.00',
          pagado: '80.00',
        }),
      ),
    ).toBe('El monto pagado ($80.00) es menor al total ($100.00).');
  });

  it('INSUFFICIENT_STOCK falls back without details', () => {
    expect(posErrorMessage(new ApiError(409, 'INSUFFICIENT_STOCK', 'x'))).toBe(
      'Stock insuficiente para completar la venta.',
    );
  });

  it('INSUFFICIENT_STOCK includes available from details', () => {
    expect(
      posErrorMessage(
        new ApiError(409, 'INSUFFICIENT_STOCK', 'x', { available: 3 }),
      ),
    ).toBe('Stock insuficiente: hay 3 disponibles.');
  });
});
