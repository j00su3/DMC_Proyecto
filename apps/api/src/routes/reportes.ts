import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AlertaConProducto } from '../alertas/service.js';
import { errorEnvelopeSchema } from '../lib/errors.js';
import { pageQuerySchema, paginated } from '../lib/pagination.js';
import type { Producto } from '../productos/repository.js';
import { requireActor } from '../productos/service.js';
import type { MovimientoConProducto } from '../reportes/service.js';
import {
  listBajoMinimo,
  listDiscrepancias,
  listStockActual,
  listarMovimientosPeriodo,
} from '../reportes/service.js';

// design.md D5: four read-only report routes, each with its own
// `config.roles`, mirroring `productos.ts`/`movimientos.ts` — no shared
// conditional branch inside one endpoint (proposal.md's approach).

const tipoAlertaSchema = z.enum([
  'stock_bajo',
  'quiebre',
  'discrepancia',
  'sugerencia_reposicion',
]);
const estadoAlertaSchema = z.enum(['activa', 'vista', 'resuelta']);

// D5's exact snippet. String comparison is valid for YYYY-MM-DD
// lexicographic order — a refine failure surfaces as a 400 VALIDATION_ERROR
// through Fastify's existing schema-validation-error mapping, no new error
// factory (D6).
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const movimientosPeriodoQuerySchema = pageQuerySchema
  .extend({ fechaDesde: isoDateSchema, fechaHasta: isoDateSchema })
  .refine((v) => v.fechaDesde <= v.fechaHasta, {
    message: 'fechaDesde must be <= fechaHasta',
    path: ['fechaDesde'],
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

const paginatedProductos = z.object({
  data: z.array(productoDto),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

const movimientoConProductoDto = z.object({
  id: z.string(),
  productoId: z.string(),
  productoNombre: z.string(),
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

const paginatedMovimientos = z.object({
  data: z.array(movimientoConProductoDto),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

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

function toMovimientoConProductoDto(movimiento: MovimientoConProducto) {
  return {
    id: movimiento.id,
    productoId: movimiento.productoId,
    productoNombre: movimiento.productoNombre,
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

function toAlertaDto(alerta: AlertaConProducto) {
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

// A bare `YYYY-MM-DD` string parses to that day's UTC midnight — matching
// D5's note that `movimientos.fecha` is `timestamptz` and the service
// (D2/D3) needs a real `Date` to convert to the half-open exclusive bound.
function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

const reportesRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/reportes/stock-actual',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        querystring: pageQuerySchema,
        response: {
          200: paginatedProductos,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      requireActor(request.user);
      const { page, pageSize } = request.query;
      const { rows, total } = await listStockActual(app.repos, {
        page,
        pageSize,
      });
      return paginated(rows.map(toProductoDto), page, pageSize, total);
    },
  );

  typed.get(
    '/reportes/bajo-minimo',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        querystring: pageQuerySchema,
        response: {
          200: paginatedProductos,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      requireActor(request.user);
      const { page, pageSize } = request.query;
      const { rows, total } = await listBajoMinimo(app.repos, {
        page,
        pageSize,
      });
      return paginated(rows.map(toProductoDto), page, pageSize, total);
    },
  );

  typed.get(
    '/reportes/movimientos',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        querystring: movimientosPeriodoQuerySchema,
        response: {
          200: paginatedMovimientos,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const actor = requireActor(request.user);
      const { page, pageSize, fechaDesde, fechaHasta } = request.query;
      const { rows, total } = await listarMovimientosPeriodo(app.repos, {
        fechaDesde: parseIsoDate(fechaDesde),
        fechaHasta: parseIsoDate(fechaHasta),
        page,
        pageSize,
        actor,
      });
      return paginated(
        rows.map(toMovimientoConProductoDto),
        page,
        pageSize,
        total,
      );
    },
  );

  // encargado-only — spec's "Discrepancias Globales Report": deposito MUST
  // receive 403 with no `data` in the body.
  typed.get(
    '/reportes/discrepancias',
    {
      config: { roles: ['encargado'] },
      schema: {
        querystring: pageQuerySchema,
        response: {
          200: paginatedAlertas,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      requireActor(request.user);
      const { page, pageSize } = request.query;
      const { rows, total } = await listDiscrepancias(app.repos, {
        page,
        pageSize,
      });
      return paginated(rows.map(toAlertaDto), page, pageSize, total);
    },
  );
};

export default reportesRoutes;
