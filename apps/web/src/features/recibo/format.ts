const FALLBACK = '—';

const formatter = new Intl.DateTimeFormat('es', {
  dateStyle: 'short',
  timeStyle: 'short',
});

/**
 * `creadoEn` arrives as an ISO string over the wire (verified precedent:
 * `features/usuarios/format.ts:5-10`), even though it is `z.date()`
 * server-side. Unlike `formatFecha` (date-only), a receipt needs the time
 * of sale too — D-Interfaces in `design.md`.
 */
export function formatFechaHora(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return FALLBACK;
  return formatter.format(date);
}
