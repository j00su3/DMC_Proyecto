export type EstadoStock = 'quiebre' | 'bajo' | 'ok';

/**
 * Pure client-derived status (D9) — never a server-computed field. Order
 * matters: `quiebre` wins over `bajo` regardless of `stockMinimo`, and
 * `stockMinimo === null` can never yield `bajo` (`TECH-DESIGNv2.md:251-252`
 * requires that a product without a threshold produces no false alarm).
 */
export function estadoStock(
  stockActual: number,
  stockMinimo: number | null,
): EstadoStock {
  if (stockActual <= 0) return 'quiebre';
  if (stockMinimo !== null && stockActual <= stockMinimo) return 'bajo';
  return 'ok';
}
