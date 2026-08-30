import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorEnvelopeSchema } from '../lib/errors.js';
import { pageQuerySchema, paginated } from '../lib/pagination.js';
import type { Movimiento } from '../movimientos/repository.js';
import {
  MOTIVO_MIN_LENGTH,
  registrarMovimiento,
} from '../movimientos/service.js';
import type { Producto } from '../productos/repository.js';
import { requireActor } from '../productos/service.js';

// design.md D5: all four movimientos routes live here, registered in
// app.ts with `{ prefix: '/api' }` ALONGSIDE productosRoutes. Fastify
// resolves `/productos/:id` (owned by routes/productos.ts) and
// `/productos/:id/movimientos*` (owned by this file) as distinct paths, so
// the split ownership of the `/productos/*` prefix is legal — this is the
// only place in the project where two plugins share a prefix segment (see
// the matching note in routes/productos.ts).

const idParams = z.object({ id: z.string().uuid() });

// D8: the route owns the *format* of motivo on all three write bodies;
// whether it is *required* is a single guard inside
// movimientos/service.ts's registrarMovimiento (RECONCILE-2: 3, not 5).
const motivoSchema = z
  .string()
  .trim()
  .min(MOTIVO_MIN_LENGTH)
  .max(500)
  .optional();

// D7: cantidad on the wire is always a positive magnitude — the sign is
// derived in the service. This is what makes PD-4's zero unrepresentable on
// the wire, rather than merely rejected by a service-level guard.
const cantidadSchema = z.number().int().min(1);

// D7's exact table. `.strict()` is load-bearing (task 4.1): it is the only
// thing standing between a contradicting esMerma/esDiscrepancia combination
// and a raw Postgres 23514 from movimientos_merma_solo_salida, which S3's
// hard constraint forbids as a mechanism for user-facing errors.
const entradaBody = z
  .object({
    cantidad: cantidadSchema,
    motivo: motivoSchema,
  })
  .strict();

const salidaBody = z
  .object({
    cantidad: cantidadSchema,
    esMerma: z.boolean(),
    motivo: motivoSchema,
  })
  .strict();

const ajusteBody = z
  .object({
    cantidad: cantidadSchema,
    direccion: z.enum(['sumar', 'restar']),
    esDiscrepancia: z.boolean(),
    motivo: motivoSchema,
  })
  .strict();

const movimientoDto = z.object({
  id: z.string(),
  productoId: z.string(),
  tipo: z.enum(['entrada', 'salida', 'ajuste', 'venta', 'anulacion']),
  cantidad: z.number().int(),
  motivo: z.string().nullable(),
  esDiscrepancia: z.boolean(),
  esMerma: z.boolean(),
  usuarioId: z.string(),
  fecha: z.date(),
  ventaId: z.string().nullable(),
  stockResultante: z.number().int(),
});

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

const okMovimiento = z.object({
  movimiento: movimientoDto,
  producto: productoDto,
});

const paginatedMovimientos = z.object({
  data: z.array(movimientoDto),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

function toMovimientoDto(movimiento: Movimiento) {
  return {
    id: movimiento.id,
    productoId: movimiento.productoId,
    tipo: movimiento.tipo,
    cantidad: movimiento.cantidad,
    motivo: movimiento.motivo,
    esDiscrepancia: movimiento.esDiscrepancia,
    esMerma: movimiento.esMerma,
    usuarioId: movimiento.usuarioId,
    fecha: movimiento.fecha,
    ventaId: movimiento.ventaId,
    stockResultante: movimiento.stockResultante,
  };
}

function toProductoDto(producto: Producto) {
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

const movimientosRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // spec.md's Movement History requirement: both roles read a product's own
  // history, paginated.
  typed.get(
    '/productos/:id/movimientos',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        params: idParams,
        querystring: pageQuerySchema,
        response: {
          200: paginatedMovimientos,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query;
      const { rows, total } = await app.repos.movimientos.listByProducto(
        request.params.id,
        page,
        pageSize,
      );
      return paginated(rows.map(toMovimientoDto), page, pageSize, total);
    },
  );

  // D5: entrada/salida open to both roles.
  typed.post(
    '/productos/:id/movimientos/entrada',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        params: idParams,
        body: entradaBody,
        response: {
          201: okMovimiento,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireActor(request.user);
      const { movimiento, producto } = await registrarMovimiento(app.uow, {
        productoId: request.params.id,
        operacion: 'entrada',
        cantidad: request.body.cantidad,
        esMerma: false,
        esDiscrepancia: false,
        motivo: request.body.motivo,
        actor,
      });
      reply.status(201);
      return {
        movimiento: toMovimientoDto(movimiento),
        producto: toProductoDto(producto),
      };
    },
  );

  typed.post(
    '/productos/:id/movimientos/salida',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        params: idParams,
        body: salidaBody,
        response: {
          201: okMovimiento,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireActor(request.user);
      const { movimiento, producto } = await registrarMovimiento(app.uow, {
        productoId: request.params.id,
        operacion: 'salida',
        cantidad: request.body.cantidad,
        esMerma: request.body.esMerma,
        esDiscrepancia: false,
        motivo: request.body.motivo,
        actor,
      });
      reply.status(201);
      return {
        movimiento: toMovimientoDto(movimiento),
        producto: toProductoDto(producto),
      };
    },
  );

  // D5: this is where PD-1's server-side boundary actually lives — a plain
  // FORBIDDEN from the preHandler (plugins/auth.ts:92-95) before any
  // handler runs, provable by a route test against the config alone.
  typed.post(
    '/productos/:id/movimientos/ajuste',
    {
      config: { roles: ['encargado'] },
      schema: {
        params: idParams,
        body: ajusteBody,
        response: {
          201: okMovimiento,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireActor(request.user);
      const { movimiento, producto } = await registrarMovimiento(app.uow, {
        productoId: request.params.id,
        operacion: 'ajuste',
        cantidad: request.body.cantidad,
        direccion: request.body.direccion,
        esMerma: false,
        esDiscrepancia: request.body.esDiscrepancia,
        motivo: request.body.motivo,
        actor,
      });
      reply.status(201);
      return {
        movimiento: toMovimientoDto(movimiento),
        producto: toProductoDto(producto),
      };
    },
  );
};

export default movimientosRoutes;
