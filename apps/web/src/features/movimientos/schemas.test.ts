import { describe, expect, it } from 'vitest';
import {
  MOTIVO_MAX_LENGTH,
  MOTIVO_MIN_LENGTH,
  movimientoFormSchema,
} from './schemas.js';

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

  /**
   * The claims gate (`openspec/changes/movimientos-inventario/claims-report.md`,
   * refuted claim 10) found this ceiling missing. `tasks.md:11`'s RECONCILE-2
   * bound the whole cycle to "`MOTIVO_MIN_LENGTH = 3`, trimmed, `max(500)`",
   * and the API honours all three (`apps/api/src/routes/movimientos.ts:27-32`),
   * but the web schema carried only the minimum.
   *
   * Without the ceiling a 501-character motivo passes this form, is submitted,
   * and comes back as a generic `VALIDATION_ERROR` that says nothing about a
   * length limit — so the operator is refused with no way to know why, and
   * loses what they typed. The server boundary always held; what was missing
   * was telling the user before the round trip.
   */
  it(`refuses a motivo one character over MOTIVO_MAX_LENGTH (${MOTIVO_MAX_LENGTH})`, () => {
    const tooLong = 'x'.repeat(MOTIVO_MAX_LENGTH + 1);
    const result = movimientoFormSchema.safeParse({
      ...base,
      eleccion: 'ajuste',
      motivo: tooLong,
    });
    expect(result.success).toBe(false);
  });

  it(`accepts a motivo of exactly MOTIVO_MAX_LENGTH (${MOTIVO_MAX_LENGTH}) characters`, () => {
    const exactMotivo = 'x'.repeat(MOTIVO_MAX_LENGTH);
    const result = movimientoFormSchema.safeParse({
      ...base,
      eleccion: 'ajuste',
      motivo: exactMotivo,
    });
    expect(result.success).toBe(true);
  });

  /**
   * The ceiling is not part of the ajuste/merma requiredness rule. `motivo` is
   * optional on an ordinary entrada, but the API applies `max(500)` to the
   * body of all three write routes, so the form must refuse an over-long one
   * on the choices where the minimum never fires. This is the half a test
   * written only against `ajuste` would miss.
   */
  it('refuses an over-long motivo on an entrada, where the minimum never fires', () => {
    const tooLong = 'x'.repeat(MOTIVO_MAX_LENGTH + 1);
    const result = movimientoFormSchema.safeParse({
      ...base,
      eleccion: 'entrada',
      motivo: tooLong,
    });
    expect(result.success).toBe(false);
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
