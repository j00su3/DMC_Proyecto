import { describe, expect, it } from 'vitest';
import { anularVentaFormSchema } from './schemas.js';

describe('anularVentaFormSchema', () => {
  it('refuses a blank motivo', () => {
    const result = anularVentaFormSchema.safeParse({ motivoAnulacion: '' });
    expect(result.success).toBe(false);
  });

  it('refuses a whitespace-only motivo (trimmed to empty)', () => {
    const result = anularVentaFormSchema.safeParse({
      motivoAnulacion: '    ',
    });
    expect(result.success).toBe(false);
  });

  it('refuses a motivo one character short of the minimum (2 chars)', () => {
    const result = anularVentaFormSchema.safeParse({
      motivoAnulacion: 'xy',
    });
    expect(result.success).toBe(false);
  });

  it('refuses a motivo one character over the maximum (501 chars)', () => {
    const result = anularVentaFormSchema.safeParse({
      motivoAnulacion: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid motivo', () => {
    const result = anularVentaFormSchema.safeParse({
      motivoAnulacion: 'Error en el cobro, cliente se retractó.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a motivo of exactly the minimum length (3 chars)', () => {
    const result = anularVentaFormSchema.safeParse({
      motivoAnulacion: 'xyz',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a motivo of exactly the maximum length (500 chars)', () => {
    const result = anularVentaFormSchema.safeParse({
      motivoAnulacion: 'x'.repeat(500),
    });
    expect(result.success).toBe(true);
  });
});
