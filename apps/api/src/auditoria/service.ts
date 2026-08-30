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

// Filters both snapshots through the entity's denylist (design.md D6) before
// handing the event to the repo, then wraps any repo failure as
// AUDIT_WRITE_FAILED (design.md D5) so a failed audit write never surfaces
// as a generic INTERNAL_ERROR and never loses its original cause. On
// `crear`, `datosPrevios` is expected to already be `null` by the caller
// (design.md D7's exception) — filtering only applies when it is non-null.
export async function recordAudit(
  repo: AuditoriaRepo,
  event: AuditEvent,
): Promise<void> {
  const { excludedFields } = FIELD_CLASSIFICATION[event.entidad];

  const filteredEvent: AuditEvent = {
    ...event,
    datosPrevios:
      event.datosPrevios === null
        ? null
        : filterExcluded(event.datosPrevios, excludedFields),
    datosPosteriores: filterExcluded(event.datosPosteriores, excludedFields),
  };

  try {
    await repo.record(filteredEvent);
  } catch (cause) {
    throw auditWriteFailed(cause);
  }
}
