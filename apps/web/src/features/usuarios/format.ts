const FALLBACK = '—';

const formatter = new Intl.DateTimeFormat('es');

/**
 * One shared date formatter (D19) — `creadoEn` arrives as an ISO string
 * (verified at `api/schema.d.ts:351-352`, even though the server schema
 * types it `z.date()`); this is the first date this app renders anywhere,
 * so there was no in-repo precedent to follow.
 */
export function formatFecha(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return FALLBACK;
  return formatter.format(date);
}
