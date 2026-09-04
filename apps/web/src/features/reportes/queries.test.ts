import { describe, expect, it } from 'vitest';
import {
  bajoMinimoQueryOptions,
  discrepanciasQueryOptions,
  movimientosPeriodoQueryOptions,
  reportesKeys,
  stockActualQueryOptions,
} from './queries.js';

describe('reportesKeys / query options', () => {
  it('keys the stock-actual query under reportesKeys.stockActual(page)', () => {
    const options = stockActualQueryOptions(2);

    expect(options.queryKey).toEqual(reportesKeys.stockActual(2));
  });

  it('keys the bajo-minimo query under reportesKeys.bajoMinimo(page)', () => {
    const options = bajoMinimoQueryOptions(1);

    expect(options.queryKey).toEqual(reportesKeys.bajoMinimo(1));
  });

  it('keys the movimientos query under reportesKeys.movimientos(page, fechaDesde, fechaHasta)', () => {
    const options = movimientosPeriodoQueryOptions(
      1,
      '2026-09-01',
      '2026-09-03',
    );

    expect(options.queryKey).toEqual(
      reportesKeys.movimientos(1, '2026-09-01', '2026-09-03'),
    );
  });

  it('keys the movimientos query differently when the date range changes', () => {
    const first = movimientosPeriodoQueryOptions(1, '2026-09-01', '2026-09-03');
    const second = movimientosPeriodoQueryOptions(
      1,
      '2026-09-02',
      '2026-09-03',
    );

    expect(first.queryKey).not.toEqual(second.queryKey);
  });

  it('keys the discrepancias query under reportesKeys.discrepancias(page)', () => {
    const options = discrepanciasQueryOptions(1);

    expect(options.queryKey).toEqual(reportesKeys.discrepancias(1));
  });
});
