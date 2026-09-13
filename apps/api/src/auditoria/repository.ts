import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.js';
import { auditoria, entidadAuditoria } from '../db/schema.js';
import type { AuditAccion, AuditEvent } from './service.js';

// auditoria-lectura design.md D1: derived from the pgEnum, NOT from
// `AuditableEntidad` (service.ts's write-side compile gate). A read path
// must be able to return any row Postgres already stores; binding it to the
// write gate would make a stored row unrepresentable if that map ever
// narrows.
export type EntidadAuditoria = (typeof entidadAuditoria.enumValues)[number];

// auditoria-lectura design.md D1: all three predicates compose with AND
// (ratified) — D2 (route layer) additionally requires `entidadId` to never
// be supplied without `entidad`, but that constraint is enforced at the
// route boundary, not here.
export interface FiltroAuditoria {
  entidad?: EntidadAuditoria;
  entidadId?: string;
  usuarioId?: string;
}

// The exact eight stored columns, read back as-is (design.md D1, spec "Read
// Response Projects Stored Snapshot As-Is") — no new filtering on
// datosPrevios/datosPosteriores here; FIELD_CLASSIFICATION already ran at
// write time.
export interface RegistroAuditoria {
  id: string;
  entidad: EntidadAuditoria;
  entidadId: string;
  accion: AuditAccion;
  usuarioId: string;
  datosPrevios: Record<string, unknown> | null;
  datosPosteriores: Record<string, unknown>;
  creadoEn: Date;
}

// The port `recordAudit` (service.ts) depends on. Defined here, not in
// service.ts, to match this codebase's established convention
// (auth/repository.ts owns UsuariosRepo/SesionesRepo, auth/service.ts
// imports them). The type-only import from service.ts below is circular
// with service.ts's `import type { AuditoriaRepo } from './repository.js'`;
// this is safe under ESM+TS because both sides are `import type` and erase
// at compile time — the same pattern already proven in db/uow.ts /
// plugins/repos.ts (see apply-progress, Phase 1).
export interface AuditoriaRepo {
  record(event: AuditEvent): Promise<void>;
  // auditoria-lectura design.md D1: one and()-composed condition, reused by
  // BOTH the page query and the count query — see the adapter's comment for
  // why this is the single most likely defect here.
  list(
    filtro: FiltroAuditoria,
    page: number,
    pageSize: number,
  ): Promise<{ rows: RegistroAuditoria[]; total: number }>;
}

// `entidad_id` is never generated here — it is read from the business
// `INSERT ... RETURNING id` result by the caller, inside the same
// transaction (design.md D8). This repo only inserts what it is given.
// Constructed with `DbExecutor` (D2), so inside `uow.run` it shares the
// same transaction/connection as the business write it accompanies (D1).
export class DrizzleAuditoriaRepo implements AuditoriaRepo {
  constructor(private readonly db: DbExecutor) {}

  async record(event: AuditEvent): Promise<void> {
    await this.db.insert(auditoria).values({
      entidad: event.entidad,
      entidadId: event.entidadId,
      accion: event.accion,
      usuarioId: event.usuarioId,
      datosPrevios: event.datosPrevios,
      datosPosteriores: event.datosPosteriores,
    });
  }

  // design.md D1: the SAME `condition` binding is passed to both the page
  // query and the count query below — never re-derived for the count query.
  // Applying a filter to only one of the two is this codebase's documented
  // recurring defect class (alertas/repository.ts:159-164,
  // proveedores/repository.ts D9, productos/repository.ts D7/D11).
  //
  // `desc(creadoEn), desc(id)` is not stylistic: `creado_en` defaults to
  // `now()`, the *transaction* timestamp, so every audit row written inside
  // one `uow.run` shares the value exactly. Without the `id` tiebreaker,
  // OFFSET pagination over those ties can drop or duplicate a row across
  // pages.
  async list(
    filtro: FiltroAuditoria,
    page: number,
    pageSize: number,
  ): Promise<{ rows: RegistroAuditoria[]; total: number }> {
    const condition = and(
      filtro.entidad ? eq(auditoria.entidad, filtro.entidad) : undefined,
      filtro.entidadId
        ? eq(auditoria.entidadId, filtro.entidadId)
        : undefined,
      filtro.usuarioId ? eq(auditoria.usuarioId, filtro.usuarioId) : undefined,
    );

    const rows = await this.db
      .select()
      .from(auditoria)
      .where(condition)
      .orderBy(desc(auditoria.creadoEn), desc(auditoria.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const totalRows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditoria)
      .where(condition);

    return {
      rows: rows as RegistroAuditoria[],
      total: totalRows[0]?.total ?? 0,
    };
  }
}
