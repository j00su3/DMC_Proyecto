import { describe, expect, it } from 'vitest';
import {
  carritoStorageEnvelopeSchema,
  confirmarVentaInputSchema,
  itemVentaInputSchema,
  pagoInputSchema,
} from './schemas.js';

const productoId = '11111111-1111-4111-8111-111111111111';

describe('itemVentaInputSchema', () => {
  it('accepts a well-formed item', () => {
    const result = itemVentaInputSchema.safeParse({
      productoId,
      cantidad: 1,
      precioUnitarioEsperado: '10.00',
    });
    expect(result.success).toBe(true);
  });

  it('refuses cantidad below 1', () => {
    const result = itemVentaInputSchema.safeParse({
      productoId,
      cantidad: 0,
      precioUnitarioEsperado: '10.00',
    });
    expect(result.success).toBe(false);
  });

  it('refuses an unknown extra key (mirrors the API .strict())', () => {
    const result = itemVentaInputSchema.safeParse({
      productoId,
      cantidad: 1,
      precioUnitarioEsperado: '10.00',
      extra: 'nope',
    });
    expect(result.success).toBe(false);
  });
});

describe('pagoInputSchema', () => {
  it('accepts every medio value', () => {
    for (const medio of ['efectivo', 'tarjeta', 'transferencia', 'qr']) {
      expect(pagoInputSchema.safeParse({ medio, monto: '10.00' }).success).toBe(
        true,
      );
    }
  });

  it('refuses an unknown medio', () => {
    const result = pagoInputSchema.safeParse({
      medio: 'cheque',
      monto: '10.00',
    });
    expect(result.success).toBe(false);
  });
});

describe('confirmarVentaInputSchema', () => {
  it('refuses an empty items array', () => {
    const result = confirmarVentaInputSchema.safeParse({
      items: [],
      pagos: [{ medio: 'efectivo', monto: '10.00' }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses an empty pagos array', () => {
    const result = confirmarVentaInputSchema.safeParse({
      items: [{ productoId, cantidad: 1, precioUnitarioEsperado: '10.00' }],
      pagos: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed body', () => {
    const result = confirmarVentaInputSchema.safeParse({
      items: [{ productoId, cantidad: 1, precioUnitarioEsperado: '10.00' }],
      pagos: [{ medio: 'efectivo', monto: '10.00' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('carritoStorageEnvelopeSchema', () => {
  it('accepts a well-formed envelope', () => {
    const result = carritoStorageEnvelopeSchema.safeParse({
      v: 1,
      items: [
        {
          productoId,
          nombre: 'Producto X',
          sku: 'SKU-X',
          precioSnapshot: '10.00',
          cantidad: 1,
          stockActual: 5,
        },
      ],
      savedAt: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it('refuses a version other than the literal 1', () => {
    const result = carritoStorageEnvelopeSchema.safeParse({
      v: 2,
      items: [],
      savedAt: Date.now(),
    });
    expect(result.success).toBe(false);
  });

  it('refuses a negative savedAt', () => {
    const result = carritoStorageEnvelopeSchema.safeParse({
      v: 1,
      items: [],
      savedAt: -1,
    });
    expect(result.success).toBe(false);
  });
});
