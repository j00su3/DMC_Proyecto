import { createHmac } from 'node:crypto';
import type { AlertasRepo } from '../alertas/repository.js';
import { auditWriteFailed } from '../lib/errors.js';
import type { ProductosRepo } from '../productos/repository.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
import type { UsuariosRepo } from '../usuarios/repository.js';
import { FIELD_CLASSIFICATION } from './fields.js';
import type {
  AuditoriaRepo,
  EntidadAuditoria,
  FiltroAuditoria,
  RegistroAuditoria,
} from './repository.js';

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

// auditoria-lectura design.md D3: the narrow ports `listar` composes over.
// Each member is `Pick<...>` so a route/service test can fake exactly the
// one method it needs, never a full repo shape.
export interface ReadRepos {
  auditoria: Pick<AuditoriaRepo, 'list'>;
  usuarios: Pick<UsuariosRepo, 'findManyByIds'>;
  proveedores: Pick<ProveedoresRepo, 'findManyByIds'>;
  productos: Pick<ProductosRepo, 'findManyByIds'>;
  alertas: Pick<AlertasRepo, 'findManyByIds'>;
}

// design.md D4/D6: enrichment is additive — raw `usuarioId`/`entidadId` stay
// on the row, never replaced by their resolved labels. Both labels are
// nullable: an unresolved referent (auditoria.entidad_id carries no FK,
// ADR-0011) resolves to `null`, never `''` (D6).
export interface RegistroAuditoriaConEtiquetas extends RegistroAuditoria {
  usuarioNombre: string | null;
  entidadEtiqueta: string | null;
}

// design.md D4's exact batching algorithm. Query bound: 2 (auditoria list +
// count, already inside repos.auditoria.list) + up to 4 label-lookup queries
// (alertas, usuarios, proveedores, productos) = <=6 total per request,
// independent of page size — the empty-bucket guard below is what makes
// that bound true, not an accident of small test fixtures.
export async function listar(
  repos: ReadRepos,
  filtro: FiltroAuditoria,
  page: number,
  pageSize: number,
): Promise<{ rows: RegistroAuditoriaConEtiquetas[]; total: number }> {
  const { rows, total } = await repos.auditoria.list(filtro, page, pageSize);

  // Step 1 — bucket (no I/O). One pass over the page.
  const porEntidad: Record<EntidadAuditoria, Set<string>> = {
    usuarios: new Set(),
    proveedores: new Set(),
    productos: new Set(),
    alertas: new Set(),
  };
  const actores = new Set<string>();
  for (const row of rows) {
    porEntidad[row.entidad].add(row.entidadId);
    actores.add(row.usuarioId);
  }

  // Step 2 — alertas FIRST: its productoId refs feed the productos union
  // below (step 3), so it must resolve before that batch is built.
  const alertaRefs =
    porEntidad.alertas.size > 0
      ? await repos.alertas.findManyByIds([...porEntidad.alertas])
      : [];
  const alertaPorId = new Map(alertaRefs.map((alerta) => [alerta.id, alerta]));

  // Step 3 — productoIds = page's own productos ids UNION alertas' productoId refs.
  const productoIds = new Set(porEntidad.productos);
  for (const alerta of alertaRefs) {
    productoIds.add(alerta.productoId);
  }

  // usuarios batch covers BOTH actor ids and entidad='usuarios' subject ids
  // in one query (design.md D4 step 4).
  const usuarioIds = new Set<string>([...actores, ...porEntidad.usuarios]);

  // Step 4 — three independent batches in parallel. Empty-bucket guard
  // (design.md D3): never call findManyByIds for a table with zero ids —
  // do not rely on Drizzle's empty-inArray behaviour.
  const [usuarioRows, proveedorRows, productoRows] = await Promise.all([
    usuarioIds.size > 0
      ? repos.usuarios.findManyByIds([...usuarioIds])
      : Promise.resolve([]),
    porEntidad.proveedores.size > 0
      ? repos.proveedores.findManyByIds([...porEntidad.proveedores])
      : Promise.resolve([]),
    productoIds.size > 0
      ? repos.productos.findManyByIds([...productoIds])
      : Promise.resolve([]),
  ]);

  // Step 5 — one Map<id, nombre> per table.
  const usuarioNombrePorId = new Map(
    usuarioRows.map((usuario) => [usuario.id, usuario.nombre]),
  );
  const proveedorNombrePorId = new Map(
    proveedorRows.map((proveedor) => [proveedor.id, proveedor.nombre]),
  );
  const productoNombrePorId = new Map(
    productoRows.map((producto) => [producto.id, producto.nombre]),
  );

  // Step 6 — pure merge (no I/O), reading only the Maps built above.
  const enriched: RegistroAuditoriaConEtiquetas[] = rows.map((row) => {
    const usuarioNombre = usuarioNombrePorId.get(row.usuarioId) ?? null;

    let entidadEtiqueta: string | null;
    if (row.entidad === 'alertas') {
      // design.md D5: alerta resolved + producto resolved => `${tipo}:
      // ${nombre}`; alerta resolved, producto missing (FK-dropped case) =>
      // `tipo` alone; alerta itself not found => null (D6).
      const alerta = alertaPorId.get(row.entidadId);
      if (!alerta) {
        entidadEtiqueta = null;
      } else {
        const productoNombre = productoNombrePorId.get(alerta.productoId);
        entidadEtiqueta = productoNombre
          ? `${alerta.tipo}: ${productoNombre}`
          : alerta.tipo;
      }
    } else if (row.entidad === 'usuarios') {
      entidadEtiqueta = usuarioNombrePorId.get(row.entidadId) ?? null;
    } else if (row.entidad === 'proveedores') {
      entidadEtiqueta = proveedorNombrePorId.get(row.entidadId) ?? null;
    } else {
      entidadEtiqueta = productoNombrePorId.get(row.entidadId) ?? null;
    }

    return { ...row, usuarioNombre, entidadEtiqueta };
  });

  return { rows: enriched, total };
}
