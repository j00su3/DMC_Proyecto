import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { movimientosPeriodoQueryOptions } from './queries.js';

export function useMovimientosPeriodo(
  page: number,
  fechaDesde: string,
  fechaHasta: string,
) {
  return useQuery({
    ...movimientosPeriodoQueryOptions(page, fechaDesde, fechaHasta),
    placeholderData: keepPreviousData,
  });
}
