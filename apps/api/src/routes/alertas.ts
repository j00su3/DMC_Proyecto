import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AlertaConProducto } from '../alertas/service.js';
import {
  contarAbiertas,
  listar,
  marcarVistas,
  resolver,
} from '../alertas/service.js';
import { errorEnvelopeSchema, unauthorized } from '../lib/errors.js';
import { pageQuerySchema, paginated } from '../lib/pagination.js';

// design.md's Interfaces/Contracts: `tipo`/`estado` are closed unions at the
// column level. Reused verbatim here rather than importing the repository
// module's TS-only types, since Zod needs its own runtime literal list.
const tipoAlertaSchema = z.enum([
  'stock_bajo',
  'quiebre',
  'discrepancia',
  'sugerencia_reposicion',
]);
const estadoAlertaSchema = z.enum(['activa', 'vista', 'resuelta']);

const alertaDto = z.object({
  id: z.string(),
  productoId: z.string(),
  productoNombre: z.string(),
  tipo: tipoAlertaSchema,
  estado: estadoAlertaSchema,
  movimientoId: z.string().nullable(),
  creadaEn: z.date(),
  resueltaEn: z.date().nullable(),
  resueltaPor: z.string().nullable(),
});

const paginatedAlertas = z.object({
  data: z.array(alertaDto),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

const conteoAlertas = z.object({ abiertas: z.number().int() });

const marcarVistasResponse = z.object({ marcadas: z.number().int() });

// The resolve route returns the bare Alerta (no `productoNombre`) — that
// field only exists for the list route's D6 N+1 resolution and `resolver()`
// in service.ts returns a plain `Alerta`, not an `AlertaConProducto`.
const alertaSinProductoDto = z.object({
  id: z.string(),
  productoId: z.string(),
  tipo: tipoAlertaSchema,
  estado: estadoAlertaSchema,
  movimientoId: z.string().nullable(),
  creadaEn: z.date(),
  resueltaEn: z.date().nullable(),
  resueltaPor: z.string().nullable(),
});

const okAlertaResuelta = z.object({ alerta: alertaSinProductoDto });

const idParams = z.object({ id: z.string().uuid() });

const listAlertasQuery = pageQuerySchema.extend({
  estado: estadoAlertaSchema.optional(),
});

function toDto(alerta: AlertaConProducto) {
  return {
    id: alerta.id,
    productoId: alerta.productoId,
    productoNombre: alerta.productoNombre,
    tipo: alerta.tipo,
    estado: alerta.estado,
    movimientoId: alerta.movimientoId,
    creadaEn: alerta.creadaEn,
    resueltaEn: alerta.resueltaEn,
    resueltaPor: alerta.resueltaPor,
  };
}

// Mirrors proveedores.ts's requireActorId: on a route with `config.roles`
// the RBAC preHandler has already thrown 403 for a null user, so this is an
// unreachable branch in practice — but it is the actor id that ends up in
// the audit trail for the resolve route.
function requireActorId(user: { id: string } | null): string {
  if (!user) {
    throw unauthorized();
  }
  return user.id;
}

const alertasRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // design.md's Routes table: both roles can view alerts (spec.md "Both
  // Roles Can View Alerts").
  typed.get(
    '/alertas',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        querystring: listAlertasQuery,
        response: {
          200: paginatedAlertas,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const { page, pageSize, estado } = request.query;
      const { rows, total } = await listar(app.repos, {
        filtro: estado ? { estado } : {},
        page,
        pageSize,
      });
      return paginated(rows.map(toDto), page, pageSize, total);
    },
  );

  // A dedicated route, not `{ data, total }` off the list route — design.md
  // Routes table: the badge polls every 60s on every screen and must not
  // pull full rows over a cold-starting free-tier Render service.
  typed.get(
    '/alertas/conteo',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        response: {
          200: conteoAlertas,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async () => {
      const abiertas = await contarAbiertas(app.repos);
      return { abiertas };
    },
  );

  // Owner-ratified 2026-09-02: `encargado`-only, unlike the two read routes
  // above. A404/409 error mapping is entirely the service's classify-on-
  // undefined logic (alertNotFound / alertAlreadyResolved /
  // alertNotManuallyResolvable).
  typed.post(
    '/alertas/:id/resolver',
    {
      config: { roles: ['encargado'] },
      schema: {
        params: idParams,
        response: {
          200: okAlertaResuelta,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const actorId = requireActorId(request.user);
      const alerta = await resolver(app.uow, {
        id: request.params.id,
        actorId,
      });
      return { alerta };
    },
  );

  // Owner-ratified 2026-09-02: both roles (design.md's Routes table) — the
  // resulting `estado: 'vista'` transition is deliberately NOT audited
  // (auditoria/fields.ts's `alertas` entry docblock: no single
  // actor-attributable row).
  typed.post(
    '/alertas/marcar-vistas',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        response: {
          200: marcarVistasResponse,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async () => {
      const marcadas = await marcarVistas(app.repos);
      return { marcadas };
    },
  );
};

export default alertasRoutes;
