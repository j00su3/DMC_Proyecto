import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors.js';
import { proveedoresErrorMessage } from './errorMessages.js';

describe('proveedoresErrorMessage', () => {
  it.each([
    ['SUPPLIER_NOT_FOUND', 'No se encontró el proveedor solicitado.'],
    ['SUPPLIER_NAME_IN_USE', 'Ese nombre ya está en uso por otro proveedor.'],
    ['VALIDATION_ERROR', 'Revise los datos ingresados e intente de nuevo.'],
    ['FORBIDDEN', 'No tiene permiso para realizar esta acción.'],
  ])('returns a distinct message for %s', (code, expected) => {
    expect(proveedoresErrorMessage(new ApiError(400, code, 'x'))).toBe(
      expected,
    );
  });

  it('returns a distinct fallback message for an unknown code', () => {
    expect(
      proveedoresErrorMessage(new ApiError(500, 'INTERNAL_ERROR', 'x')),
    ).toBe('Ocurrió un error inesperado. Intente de nuevo.');
  });
});
