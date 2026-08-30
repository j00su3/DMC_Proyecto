import { describe, expect, it } from 'vitest';
import { MOTIVO_MIN_LENGTH, movimientoFormSchema } from './schemas.js';

const base = {
  eleccion: 'entrada' as const,
  cantidad: '5',
  direccion: 'sumar' as const,
  esDiscrepancia: false,
  motivo: '',
};

describe('movimientoFormSchema', () => {
  it('accepts an entrada with a blank motivo', () => {
    const result = movimientoFormSchema.safeParse({
      ...base,
      eleccion: 'entrada',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an ordinary salida with a blank motivo', () => {
    const result = movimientoFormSchema.safeParse({
      ...base,
      eleccion: 'salida',
    });
    expect(result.success).toBe(true);
  });

  it('refuses an ajuste with a blank motivo', () => {
    const result = movimientoFormSchema.safeParse({
      ...base,
      eleccion: 'ajuste',
    });
    expect(result.success).toBe(false);
  });

  it('refuses a merma with a blank motivo', () => {
    const result = movimientoFormSchema.safeParse({
      ...base,
      eleccion: 'merma',
    });
    expect(result.success).toBe(false);
  });

  it(`refuses an ajuste with a motivo one character short of MOTIVO_MIN_LENGTH (${MOTIVO_MIN_LENGTH})`, () => {
    const shortMotivo = 'x'.repeat(MOTIVO_MIN_LENGTH - 1);
    const result = movimientoFormSchema.safeParse({
      ...base,
      eleccion: 'ajuste',
      motivo: shortMotivo,
    });
    expect(result.success).toBe(false);
  });

  it(`accepts an ajuste with a motivo of exactly MOTIVO_MIN_LENGTH (${MOTIVO_MIN_LENGTH}) characters`, () => {
    const exactMotivo = 'x'.repeat(MOTIVO_MIN_LENGTH);
    const result = movimientoFormSchema.safeParse({
      ...base,
      eleccion: 'ajuste',
      motivo: exactMotivo,
    });
    expect(result.success).toBe(true);
  });

  it('refuses cantidad that is not a positive integer string', () => {
    const result = movimientoFormSchema.safeParse({ ...base, cantidad: '0' });
    expect(result.success).toBe(false);
  });

  it('accepts cantidad of exactly 1', () => {
    const result = movimientoFormSchema.safeParse({ ...base, cantidad: '1' });
    expect(result.success).toBe(true);
  });

  it('refuses an unknown eleccion value', () => {
    const result = movimientoFormSchema.safeParse({
      ...base,
      eleccion: 'devolucion',
    });
    expect(result.success).toBe(false);
  });
});
