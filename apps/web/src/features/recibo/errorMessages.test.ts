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

  it('maps SALE_ALREADY_VOIDED to a conflict-specific copy (Phase 6.3)', () => {
    expect(
      reciboErrorMessage(new ApiError(409, 'SALE_ALREADY_VOIDED', 'x')),
    ).toBe('Esta venta ya fue anulada.');
  });

  it('leaves SALE_NOT_FOUND unaffected by the new SALE_ALREADY_VOIDED branch', () => {
    expect(reciboErrorMessage(new ApiError(404, 'SALE_NOT_FOUND', 'x'))).toBe(
      'No se encontró ningún recibo con ese número o identificador.',
    );
  });

  it('maps VALIDATION_ERROR to a review-your-input copy (Phase 7.2 server-error mapping)', () => {
    expect(reciboErrorMessage(new ApiError(400, 'VALIDATION_ERROR', 'x'))).toBe(
      'Revise los datos ingresados e intente de nuevo.',
    );
  });
});
