// Per-entity field classification for the audit trail (backlog #2.2).
//
// The runtime filter stays a denylist (ADR-0012 rule 4): `excludedFields` is
// what `recordAudit` actually applies. `auditableFields` is consumed by
// nothing but `fields.test.ts` — its only job is to make exhaustiveness a
// build-time-checkable, red-by-name assertion instead of a convention
// (design.md D11). `hashContrasenaDenylist` is the floor D12 asks for: a
// global check that holds even if a future entity's entry forgets it.

export const HASH_CONTRASENA_DENYLIST_FIELD = 'hashContrasena';

// Domain-separation tag per pseudonymized field (backlog #2.5, D-22): each
// field's HMAC input is `tag + value`, so the same string under two fields
// never yields the same pseudonym, and one use of COOKIE_SECRET can never
// collide with another. The tags differ early and none is a prefix of
// another (`fields.test.ts` checks both), so no `tag + value` input can
// collide across fields.
//
// The map is keyed by FIELD name, not by entity: a future entity that
// pseudonymizes a field also called `nombre` would share
// `audit-nombre-pseudonym:`, so its pseudonyms could be linked with users'
// names. Owner decision: recorded, not solved; if it comes up, the tag key
// should include the entity.
//
// `email`'s tag is the one that shipped with #2.5. Changing its bytes would
// silently re-pseudonymize every historical email (`service.test.ts` pins
// the digest).
export const PSEUDONYM_DOMAIN_TAGS = {
  email: 'audit-email-pseudonym:',
  nombre: 'audit-nombre-pseudonym:',
} as const;

export type PseudonymizedField = keyof typeof PSEUDONYM_DOMAIN_TAGS;

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
  // storing the plaintext. Only fields with an entry in
  // `PSEUDONYM_DOMAIN_TAGS` can be listed: an untagged field is a
  // `pnpm typecheck` error through the `satisfies` below.
  pseudonymizedFields?: readonly PseudonymizedField[];
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
    // in plaintext. D-22 extends the same treatment to `nombre`, a person's
    // name being personal data too. Rows written before that change keep
    // their plaintext name and are not rewritten.
    pseudonymizedFields: ['email', 'nombre'],
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
  // #10 (motor-alertas) design.md's Audit Wiring (PD-5): unlocks the
  // compile gate for `recordAudit({ entidad: 'alertas' })`. Creation and
  // manual resolution are audited (`'crear'`/`'actualizar'`, no new
  // AuditAccion value); the bulk `marcarVistas` UPDATE is deliberately NOT
  // audited — it has no single actor-attributable row (design.md's Audit
  // Wiring section). Nothing here is secret: no excluded/pseudonymized
  // field, same shape as proveedores.
  alertas: {
    auditableFields: [
      'id',
      'productoId',
      'tipo',
      'estado',
      'movimientoId',
      'creadaEn',
      'resueltaEn',
      'resueltaPor',
    ],
    excludedFields: [],
    pseudonymizedFields: [],
  },
} as const satisfies Record<string, EntityFieldClassification>;
