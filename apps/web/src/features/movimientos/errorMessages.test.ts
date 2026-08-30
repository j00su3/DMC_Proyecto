import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors.js';
import { movimientosErrorMessage } from './errorMessages.js';

describe('movimientosErrorMessage', () => {
  it.each([
    ['FORBIDDEN', 'No tiene permiso para realizar esta acción.'],
    ['MOVEMENT_REASON_REQUIRED', 'Ingrese un motivo para este movimiento.'],
    ['VALIDATION_ERROR', 'Revise los datos ingresados e intente de nuevo.'],
    ['PRODUCT_NOT_FOUND', 'No se encontró el producto solicitado.'],
    ['PRODUCT_INACTIVE', 'El producto está inactivo y no admite movimientos.'],
  ])('returns a distinct message for %s', (code, expected) => {
    expect(movimientosErrorMessage(new ApiError(400, code, 'x'))).toBe(
      expected,
    );
  });

  it('returns a distinct fallback message for an unknown code', () => {
    expect(
      movimientosErrorMessage(new ApiError(500, 'INTERNAL_ERROR', 'x')),
    ).toBe('Ocurrió un error inesperado. Intente de nuevo.');
  });

  it('interpolates details.available into the INSUFFICIENT_STOCK message', () => {
    expect(
      movimientosErrorMessage(
        new ApiError(409, 'INSUFFICIENT_STOCK', 'x', { available: 5 }),
      ),
    ).toBe('Stock insuficiente: hay 5 disponibles.');
  });

  it('interpolates a different details.available value distinctly', () => {
    expect(
      movimientosErrorMessage(
        new ApiError(409, 'INSUFFICIENT_STOCK', 'x', { available: 12 }),
      ),
    ).toBe('Stock insuficiente: hay 12 disponibles.');
  });

  it('falls back to a generic INSUFFICIENT_STOCK message when details is missing', () => {
    expect(
      movimientosErrorMessage(new ApiError(409, 'INSUFFICIENT_STOCK', 'x')),
    ).toBe('Stock insuficiente para este movimiento.');
  });
});
