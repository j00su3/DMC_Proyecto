// Per-entity field classification for the audit trail (backlog #2.2).
//
// The runtime filter stays a denylist (ADR-0012 rule 4): `excludedFields` is
// what `recordAudit` actually applies. `auditableFields` is consumed by
// nothing but `fields.test.ts` — its only job is to make exhaustiveness a
// build-time-checkable, red-by-name assertion instead of a convention
// (design.md D11). `hashContrasenaDenylist` is the floor D12 asks for: a
// global check that holds even if a future entity's entry forgets it.

export const HASH_CONTRASENA_DENYLIST_FIELD = 'hashContrasena';

interface EntityFieldClassification {
  auditableFields: readonly string[];
  excludedFields: readonly string[];
  // Subset of `auditableFields` (backlog #2.5, closes SEC-012). NOT part of
  // the exhaustiveness exclude/auditable partition `fields.test.ts` checks —
  // a pseudonymized field still counts as "auditable" there, it just never
  // reaches a snapshot in plaintext. `recordAudit` (service.ts) replaces
  // each listed field's value with a keyed HMAC pseudonym after exclusion
  // filtering, so a change to the field still shows a visible diff (unlike
  // omitting it outright, which the owner rejected 2026-09-01) without ever
  // storing the plaintext.
  pseudonymizedFields?: readonly string[];
}

// `usuarios` classified now; `proveedores`/`productos` join here when #4/#5
// give them a call site (design.md D9). Adding an entity key here is what
// makes `AuditableEntidad = keyof typeof FIELD_CLASSIFICATION` include it.
export const FIELD_CLASSIFICATION = {
  usuarios: {
    auditableFields: [
      'id',
      'nombre',
      'email',
      'rol',
      'activo',
      'intentosFallidos',
      'bloqueadoHasta',
      'creadoEn',
      'debeCambiarPassword',
    ],
    excludedFields: [HASH_CONTRASENA_DENYLIST_FIELD],
    // SEC-012 / backlog #2.5, owner-ratified 2026-09-01: the actor's
    // identity already lives in the UUID `auditoria.usuario_id`; `email`
    // stays auditable (a changed value should show in the trail) but never
    // in plaintext.
    pseudonymizedFields: ['email'],
  },
  // #4 gives this entity its call site (S4). No excluded field — nothing on
  // `proveedores` is secret (design.md D5).
  proveedores: {
    auditableFields: ['id', 'nombre', 'contacto', 'activo', 'creadoEn'],
    excludedFields: [],
    // Nothing on proveedores is pseudonymized either — explicit `[]`, not
    // an omitted key, so `FIELD_CLASSIFICATION[entidad].pseudonymizedFields`
    // stays a uniform property across the union (`as const satisfies`
    // narrows each entry to only its own literal keys otherwise).
    pseudonymizedFields: [],
  },
  // #5 (S3a/S3b) gives this entity its call sites. `stockActual` is
  // excluded, not secret (R1, owner-settled 2026-08-29): a change in
  // physical units belongs to `movimientos` (ADR-0012 rule 1), and a
  // movement already audits itself (rule 2), so repeating the same
  // unchanging value in every snapshot would be noise, not signal.
  productos: {
    auditableFields: [
      'id',
      'nombre',
      'sku',
      'categoria',
      'stockMinimo',
      'precio',
      'proveedorId',
      'activo',
      'creadoEn',
    ],
    excludedFields: ['stockActual'],
    pseudonymizedFields: [],
  },
} as const satisfies Record<string, EntityFieldClassification>;
