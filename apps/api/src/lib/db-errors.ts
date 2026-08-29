// node-postgres carries the Postgres SQLSTATE on `.code`; 23505 is
// unique_violation, which the usuarios_email_unique index raises.
//
// The chain walk is not defensive padding. Drizzle wraps every driver error
// in a `DrizzleQueryError` and hangs the `pg` error off `.cause`, so the
// SQLSTATE is one level down and a top-level `.code` read finds nothing —
// which would have turned every duplicate email into a 500 instead of a 409.
// Both levels are checked so the mapping survives Drizzle changing its mind
// about wrapping. Depth is bounded because a `cause` chain can be cyclic.
export function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    if ((current as { code?: unknown }).code === '23505') {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
