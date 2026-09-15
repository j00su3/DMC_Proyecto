import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RegistroAuditoriaConEtiquetas } from '../auditoria/service.js';
import { listar } from '../auditoria/service.js';
import { errorEnvelopeSchema } from '../lib/errors.js';
import { pageQuerySchema, paginated } from '../lib/pagination.js';
import { requireActor } from '../productos/service.js';

// design.md D7: `entidadId` requires `entidad` — the composite index
// (`auditoria_entidad_entidad_id_creado_en_idx`) leads with `entidad`, and
// `entidad_id` carries no FK (ADR-0011), so it is not table-unique on its
// own. Surfaces as 400 VALIDATION_ERROR through Fastify's existing
// schema-validation-error mapping (same mechanism as
// `movimientosPeriodoQuerySchema`'s refine, routes/reportes.ts).
const auditoriaQuerySchema = pageQuerySchema
  .extend({
    entidad: z
      .enum(['usuarios', 'proveedores', 'productos', 'alertas'])
      .optional(),
    entidadId: z.string().uuid().optional(),
    usuarioId: z.string().uuid().optional(),
  })
  .refine((v) => v.entidadId === undefined || v.entidad !== undefined, {
    message: 'entidadId requires entidad',
    path: ['entidadId'],
  });

// design.md D7: the eight stored columns read back as-is, plus the two
// additive labels (D3-D6). Snapshot fields project verbatim — no new
// filtering here, `FIELD_CLASSIFICATION` already ran at write time (spec
// "Read Response Projects Stored Snapshot As-Is").
const registroAuditoriaDto = z.object({
  id: z.string(),
  entidad: z.enum(['usuarios', 'proveedores', 'productos', 'alertas']),
  entidadId: z.string(),
  accion: z.enum([
    'crear',
    'actualizar',
    'baja_logica',
    'reactivar',
    'cambiar_password',
  ]),
  usuarioId: z.string(),
  datosPrevios: z.record(z.string(), z.unknown()).nullable(),
  datosPosteriores: z.record(z.string(), z.unknown()),
  creadoEn: z.date(),
  usuarioNombre: z.string().nullable(),
  entidadEtiqueta: z.string().nullable(),
});

const paginatedAuditoria = z.object({
  data: z.array(registroAuditoriaDto),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

function toRegistroAuditoriaDto(row: RegistroAuditoriaConEtiquetas) {
  return {
    id: row.id,
    entidad: row.entidad,
    entidadId: row.entidadId,
    accion: row.accion,
    usuarioId: row.usuarioId,
    datosPrevios: row.datosPrevios,
    datosPosteriores: row.datosPosteriores,
    creadoEn: row.creadoEn,
    usuarioNombre: row.usuarioNombre,
    entidadEtiqueta: row.entidadEtiqueta,
  };
}

// design.md D7: the only endpoint reversing the write-only-scope prohibition
// (closes drift finding D-01). encargado-only — `deposito` MUST receive 403
// with no `data` in the body.
const auditoriaRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/auditoria',
    {
      config: { roles: ['encargado'] },
      schema: {
        querystring: auditoriaQuerySchema,
        response: {
          200: paginatedAuditoria,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      requireActor(request.user);
      const { page, pageSize, entidad, entidadId, usuarioId } = request.query;
      const { rows, total } = await listar(
        app.repos,
        { entidad, entidadId, usuarioId },
        page,
        pageSize,
      );
      return paginated(rows.map(toRegistroAuditoriaDto), page, pageSize, total);
    },
  );
};

export default auditoriaRoutes;
