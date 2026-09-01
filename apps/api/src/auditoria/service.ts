import { createHmac } from 'node:crypto';
import { auditWriteFailed } from '../lib/errors.js';
import { FIELD_CLASSIFICATION } from './fields.js';
import type { AuditoriaRepo } from './repository.js';

// `entidad` is keyed off the classification map, not off the pgEnum: an
// entity with no classified columns does not compile (design.md D9 + D11).
// Entries today: 'usuarios', 'proveedores', 'productos'. Adding a fourth
// entity means adding its entry here first, or its recordAudit call site
// will not compile.
export type AuditableEntidad = keyof typeof FIELD_CLASSIFICATION;

export type AuditAccion =
  | 'crear'
  | 'actualizar'
  | 'baja_logica'
  | 'reactivar'
  | 'cambiar_password';

// No parameter here admits a quantity of units (ADR-0012 rule 3, design.md
// D15) — enforced by the compiler via the `@ts-expect-error` test in
// service.test.ts, not by code review.
export interface AuditEvent<E extends AuditableEntidad = AuditableEntidad> {
  entidad: E;
  entidadId: string; // uuid, no FK (ADR-0011)
  accion: AuditAccion;
  usuarioId: string; // actor; FK, restrict (design.md D14)
  datosPrevios: Record<string, unknown> | null; // null iff accion === 'crear' (design.md D7)
  datosPosteriores: Record<string, unknown>;
}

function filterExcluded(
  data: Record<string, unknown>,
  excludedFields: readonly string[],
): Record<string, unknown> {
  const excluded = new Set(excludedFields);
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !excluded.has(key)),
  );
}

// Domain-separation tag (backlog #2.5): scopes this HMAC to exactly this
// use, so it can never collide with another use of the same key (e.g. a
// future HMAC-shaped session token keyed off the same COOKIE_SECRET).
const PSEUDONYM_DOMAIN_TAG = 'audit-email-pseudonym:';
const PSEUDONYM_PREFIX = 'hmac-sha256:';

// Replaces each listed field's value, when present and a string, with a
// keyed HMAC-SHA256 pseudonym (SEC-012 / backlog #2.5, owner-ratified
// 2026-09-01: pseudonymize, not omit). Deterministic under a fixed key, so
// the SAME value always produces the SAME pseudonym — an email-only change
// still shows a visible diff between `datosPrevios` and `datosPosteriores`,
// which is the exact edge case that blocked this backlog item when the
// alternative (moving `email` to `excludedFields`) was tried instead: both
// snapshots would drop the key entirely and read as identical/empty.
//
// A real HMAC, not `crypto.createHash`: a bare hash of an email is
// reversible by a dictionary/rainbow-table attack against common address
// patterns. This project already treats that class of risk seriously
// (argon2id for passwords, HMAC-shaped session tokens), so the pseudonym
// gets the same treatment.
export function pseudonymizeFields(
  data: Record<string, unknown>,
  pseudonymizedFields: readonly string[],
  key: string,
): Record<string, unknown> {
  const result = { ...data };
  for (const field of pseudonymizedFields) {
    const value = result[field];
    if (typeof value === 'string') {
      const digest = createHmac('sha256', key)
        .update(PSEUDONYM_DOMAIN_TAG + value)
        .digest('hex');
      result[field] = `${PSEUDONYM_PREFIX}${digest}`;
    }
  }
  return result;
}

// COOKIE_SECRET reused as the HMAC key (backlog #2.5): it is already
// required at startup and validated to be >=32 chars (`lib/env.ts`), so this
// avoids introducing a second secret. Read directly off `process.env`
// rather than importing `lib/env.ts`, matching `plugins/cookie.ts`'s
// `resolveCookieSecret` — importing the full env schema here would drag
// DATABASE_URL et al. into every unit test that exercises `recordAudit`
// (see that file's comment). The unit test suite sets COOKIE_SECRET in
// `vitest.config.ts` for exactly this reason; production sets it as a real
// deployment secret, validated by `lib/env.ts` before the server accepts
// any request.
function resolvePseudonymKey(): string {
  const key = process.env.COOKIE_SECRET;
  if (!key) {
    throw new Error(
      'COOKIE_SECRET must be set to pseudonymize audit snapshot fields',
    );
  }
  return key;
}

// Filters both snapshots through the entity's denylist (design.md D6), then
// pseudonymizes the entity's `pseudonymizedFields` (backlog #2.5), before
// handing the event to the repo, then wraps any repo failure as
// AUDIT_WRITE_FAILED (design.md D5) so a failed audit write never surfaces
// as a generic INTERNAL_ERROR and never loses its original cause. On
// `crear`, `datosPrevios` is expected to already be `null` by the caller
// (design.md D7's exception) — filtering/pseudonymizing only applies when
// it is non-null.
export async function recordAudit(
  repo: AuditoriaRepo,
  event: AuditEvent,
): Promise<void> {
  const { excludedFields, pseudonymizedFields } =
    FIELD_CLASSIFICATION[event.entidad];
  const hasPseudonymizedFields = (pseudonymizedFields?.length ?? 0) > 0;
  // Resolved at most once per call, and only when this entity actually has
  // fields to pseudonymize — proveedores/productos never need COOKIE_SECRET.
  const pseudonymKey = hasPseudonymizedFields
    ? resolvePseudonymKey()
    : undefined;

  const applyClassification = (
    data: Record<string, unknown>,
  ): Record<string, unknown> => {
    const filtered = filterExcluded(data, excludedFields);
    return pseudonymKey && pseudonymizedFields
      ? pseudonymizeFields(filtered, pseudonymizedFields, pseudonymKey)
      : filtered;
  };

  const filteredEvent: AuditEvent = {
    ...event,
    datosPrevios:
      event.datosPrevios === null
        ? null
        : applyClassification(event.datosPrevios),
    datosPosteriores: applyClassification(event.datosPosteriores),
  };

  try {
    await repo.record(filteredEvent);
  } catch (cause) {
    throw auditWriteFailed(cause);
  }
}
