import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors.js';
import { reciboErrorMessage } from './errorMessages.js';

describe('reciboErrorMessage', () => {
  it('maps SALE_NOT_FOUND to the generic not-found copy (PD-5)', () => {
    expect(reciboErrorMessage(new ApiError(404, 'SALE_NOT_FOUND', 'x'))).toBe(
      'No se encontró ningún recibo con ese número o identificador.',
    );
  });

  it('falls back to a generic message for an unknown code', () => {
    expect(reciboErrorMessage(new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(
      'Ocurrió un error inesperado. Intente de nuevo.',
    );
  });
});
