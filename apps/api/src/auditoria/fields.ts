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
  },
  // #4 gives this entity its call site (S4). No excluded field — nothing on
  // `proveedores` is secret (design.md D5).
  proveedores: {
    auditableFields: ['id', 'nombre', 'contacto', 'activo', 'creadoEn'],
    excludedFields: [],
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
  },
} as const satisfies Record<string, EntityFieldClassification>;
