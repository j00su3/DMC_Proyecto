import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors.js';
import { productosErrorMessage } from './errorMessages.js';

describe('productosErrorMessage', () => {
  it.each([
    ['PRODUCT_NOT_FOUND', 'No se encontró el producto solicitado.'],
    ['SKU_ALREADY_IN_USE', 'Ese SKU ya está en uso por otro producto.'],
    [
      'FIELD_RESERVED_FOR_ENCARGADO',
      'Solo un encargado puede modificar el stock mínimo.',
    ],
    [
      'SUPPLIER_INACTIVE',
      'El proveedor seleccionado está inactivo y no puede usarse en productos nuevos.',
    ],
    ['VALIDATION_ERROR', 'Revise los datos ingresados e intente de nuevo.'],
    ['FORBIDDEN', 'No tiene permiso para realizar esta acción.'],
  ])('returns a distinct message for %s', (code, expected) => {
    expect(productosErrorMessage(new ApiError(400, code, 'x'))).toBe(expected);
  });

  it('returns a distinct fallback message for an unknown code', () => {
    expect(
      productosErrorMessage(new ApiError(500, 'INTERNAL_ERROR', 'x')),
    ).toBe('Ocurrió un error inesperado. Intente de nuevo.');
  });
});
