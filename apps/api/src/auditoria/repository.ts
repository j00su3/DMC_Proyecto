import type { DbExecutor } from '../db/client.js';
import { auditoria } from '../db/schema.js';
import type { AuditEvent } from './service.js';

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
}
