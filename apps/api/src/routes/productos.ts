import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorEnvelopeSchema } from '../lib/errors.js';
import { pageQuerySchema, paginated } from '../lib/pagination.js';
import type { Producto } from '../productos/repository.js';
import {
  actualizarProducto,
  crearProducto,
  getProducto,
  listProductos,
  requireActor,
} from '../productos/service.js';

// tasks.md Phase 6 (S4a) — this file ships GET/POST/PATCH only.
// POST /api/productos/:id/{deactivate,reactivate} are Phase 7 (S4b), and
// this plugin is NOT registered in app.ts yet — that registration is task
// 7.2, deliberately deferred so `apps/api/openapi.json` stays
// byte-identical for this slice (`pnpm contract:check` proves it).

const productoDto = z.object({
  id: z.string(),
  nombre: z.string(),
  sku: z.string(),
  categoria: z.string().nullable(),
  stockActual: z.number().int(),
  stockMinimo: z.number().int().nullable(),
  precio: z.string(),
  proveedorId: z.string(),
  activo: z.boolean(),
  creadoEn: z.date(),
});

const okProducto = z.object({ producto: productoDto });

const paginatedProductos = z.object({
  data: z.array(productoDto),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

const idParams = z.object({ id: z.string().uuid() });

// Search is optional (spec.md's "List Products Supports Pagination And
// Search By Name Or SKU"), composed alongside the shared page/pageSize
// schema rather than duplicating it (D7 owns the ILIKE/escaping logic at
// the repository layer — this schema only carries the raw term through).
const productosQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).optional(),
});

// A decimal string with up to 2 fractional digits, matching the
// `numeric(12,2)` column (schema.ts:169) — drizzle's default numeric mode
// is a string, so this never touches floating-point precision.
const precioSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'precio must be a decimal string, e.g. "10.00"');

const crearProductoBody = z.object({
  nombre: z.string().trim().min(1),
  sku: z.string().trim().min(1),
  categoria: z.string().trim().min(1).nullable().optional(),
  // Optional at the Zod level; the field-level guard inside
  // crearProducto()/actualizarProducto() is a key-presence check
  // (`Object.hasOwn`), not a `!== undefined` check, so `{ stockMinimo: null
  // }` is still refused for a deposito actor.
  stockMinimo: z.number().int().nullable().optional(),
  precio: precioSchema,
  proveedorId: z.string().uuid(),
  stockInicial: z.number().int().min(0).default(0),
});

// `.strict()` is the load-bearing part, same technique as
// `actualizarProveedorBody` (routes/proveedores.ts:52-60): this shape has NO
// `stockActual` key at all, so a payload carrying one is refused as a
// VALIDATION_ERROR before any handler runs — a handler-level check would run
// AFTER the request already reached the service. Deliberately no `.refine`
// rejecting an empty body (unlike proveedores): an empty PATCH is a
// legitimate no-op here (tasks.md task 5.1's D10 rule), not an error.
const actualizarProductoBody = z
  .object({
    nombre: z.string().trim().min(1).optional(),
    sku: z.string().trim().min(1).optional(),
    categoria: z.string().trim().min(1).nullable().optional(),
    stockMinimo: z.number().int().nullable().optional(),
    precio: precioSchema.optional(),
    proveedorId: z.string().uuid().optional(),
  })
  .strict();

function toDto(producto: Producto) {
  return {
    id: producto.id,
    nombre: producto.nombre,
    sku: producto.sku,
    categoria: producto.categoria,
    stockActual: producto.stockActual,
    stockMinimo: producto.stockMinimo,
    precio: producto.precio,
    proveedorId: producto.proveedorId,
    activo: producto.activo,
    creadoEn: producto.creadoEn,
  };
}

const productosRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // spec.md's Role Gate requirement: read/create/update are open to both
  // roles (deposito may create/edit products, just not `stockMinimo`);
  // deactivate/reactivate (Phase 7) are encargado-only.
  typed.get(
    '/productos',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        querystring: productosQuerySchema,
        response: {
          200: paginatedProductos,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query;
      const { rows, total } = await listProductos(app.repos, {
        page,
        pageSize,
        q,
      });
      return paginated(rows.map(toDto), page, pageSize, total);
    },
  );

  typed.get(
    '/productos/:id',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        params: idParams,
        response: {
          200: okProducto,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const producto = await getProducto(app.repos, request.params.id);
      return { producto: toDto(producto) };
    },
  );

  typed.post(
    '/productos',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        body: crearProductoBody,
        response: {
          201: okProducto,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireActor(request.user);
      const producto = await crearProducto(app.repos, app.uow, {
        ...request.body,
        actor,
      });
      reply.status(201);
      return { producto: toDto(producto) };
    },
  );

  typed.patch(
    '/productos/:id',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        params: idParams,
        body: actualizarProductoBody,
        response: {
          200: okProducto,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const actor = requireActor(request.user);
      const producto = await actualizarProducto(app.repos, app.uow, {
        id: request.params.id,
        cambios: request.body,
        actor,
      });
      return { producto: toDto(producto) };
    },
  );
};

export default productosRoutes;
