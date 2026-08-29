import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorEnvelopeSchema, unauthorized } from '../lib/errors.js';
import { pageQuerySchema, paginated } from '../lib/pagination.js';
import type { Proveedor } from '../proveedores/repository.js';
import {
  createProveedor,
  getProveedor,
  listProveedores,
  setProveedorActivo,
  updateProveedor,
} from '../proveedores/service.js';

// Its own DTO, mirroring usuarios.ts's usuarioResumenDto (D6/D16). No secret
// field lives on a proveedor row, so unlike usuarios there is no second,
// disjoint DTO to keep separate here.
const proveedorDto = z.object({
  id: z.string(),
  nombre: z.string(),
  contacto: z.string().nullable(),
  activo: z.boolean(),
  creadoEn: z.date(),
});

const okProveedor = z.object({ proveedor: proveedorDto });

const paginatedProveedores = z.object({
  data: z.array(proveedorDto),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

const idParams = z.object({ id: z.string().uuid() });

// D3: trimmed at the Zod boundary, so the length check runs on the trimmed
// value — an all-whitespace nombre is a VALIDATION_ERROR, not an empty
// supplier name that reaches the service.
const crearProveedorBody = z.object({
  nombre: z.string().trim().min(1),
  contacto: z.string().trim().min(1).nullable().optional(),
});

// D11: `contacto` is nullable in the column, so clearing it must be
// expressible — omit to leave alone, send a non-empty string to set, send
// `null` to clear. Empty string is not a third spelling of null.
// `.strict()` is the load-bearing part: deactivate/reactivate are their own
// routes precisely so `activo` is unreachable here and the audit verb is
// never derived from a patch shape. `.refine` stops an empty body from
// answering 200 having done nothing.
const actualizarProveedorBody = z
  .object({
    nombre: z.string().trim().min(1).optional(),
    contacto: z.string().trim().min(1).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one of nombre or contacto is required',
  });

function toDto(proveedor: Proveedor) {
  return {
    id: proveedor.id,
    nombre: proveedor.nombre,
    contacto: proveedor.contacto,
    activo: proveedor.activo,
    creadoEn: proveedor.creadoEn,
  };
}

// Mirrors usuarios.ts's requireActorId: on a `roles: ['encargado']` route
// the RBAC hook has already thrown 403 for a null user, so this is an
// unreachable branch — but it is the actor id that ends up in the audit
// trail, and a silent `?? ''` there would write a row that names nobody.
function requireActorId(user: { id: string } | null): string {
  if (!user) {
    throw unauthorized();
  }
  return user.id;
}

const proveedoresRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // D6: the first per-route RBAC read/write split in this codebase. Reads
  // take both roles; every write below takes `['encargado']` only. This is
  // a genuine server-side authorization boundary — the preHandler hook
  // refuses a deposito write before any handler runs, not a UI affordance.
  typed.get(
    '/proveedores',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        querystring: pageQuerySchema,
        response: {
          200: paginatedProveedores,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query;
      const { rows, total } = await listProveedores(app.repos, {
        page,
        pageSize,
      });
      return paginated(rows.map(toDto), page, pageSize, total);
    },
  );

  typed.get(
    '/proveedores/:id',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        params: idParams,
        response: {
          200: okProveedor,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const proveedor = await getProveedor(app.repos, request.params.id);
      return { proveedor: toDto(proveedor) };
    },
  );

  typed.post(
    '/proveedores',
    {
      config: { roles: ['encargado'] },
      schema: {
        body: crearProveedorBody,
        response: {
          201: okProveedor,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const actorId = requireActorId(request.user);
      const proveedor = await createProveedor(app.uow, {
        ...request.body,
        actorId,
      });
      reply.status(201);
      return { proveedor: toDto(proveedor) };
    },
  );

  typed.patch(
    '/proveedores/:id',
    {
      config: { roles: ['encargado'] },
      schema: {
        params: idParams,
        body: actualizarProveedorBody,
        response: {
          200: okProveedor,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const actorId = requireActorId(request.user);
      const proveedor = await updateProveedor(app.uow, {
        id: request.params.id,
        cambios: request.body,
        actorId,
      });
      return { proveedor: toDto(proveedor) };
    },
  );

  // Two explicit routes rather than one PATCH carrying `activo` (D11),
  // mirroring usuarios.ts exactly: the path names the transition, so the
  // audit verb is decided by which URL was called, not inferred from a diff.
  for (const [segment, activo] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    typed.post(
      `/proveedores/:id/${segment}`,
      {
        config: { roles: ['encargado'] },
        schema: {
          params: idParams,
          response: {
            200: okProveedor,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        const actorId = requireActorId(request.user);
        const proveedor = await setProveedorActivo(app.uow, {
          id: request.params.id,
          activo,
          actorId,
        });
        return { proveedor: toDto(proveedor) };
      },
    );
  }
};

export default proveedoresRoutes;
