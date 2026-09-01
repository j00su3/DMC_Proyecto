import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorEnvelopeSchema } from '../lib/errors.js';
import { pageQuerySchema, paginated } from '../lib/pagination.js';
import type { Producto } from '../productos/repository.js';
import { requireActor } from '../productos/service.js';
import type {
  ItemVenta,
  MedioPago,
  Pago,
  Venta,
} from '../ventas/repository.js';
import { confirmarVenta, getRecibo } from '../ventas/service.js';
import type { ReciboItem } from '../ventas/service.js';

// design.md D11: both routes live here, registered in app.ts with
// `{ prefix: '/api' }` alongside every other route plugin. Neither path
// overlaps an existing route's segment (unlike routes/movimientos.ts's
// deliberate `/productos/*` split), so no shared-prefix note is needed.

// design.md D12/RECONCILE-1: medio/monto shape and empty-array guards are
// wire-level VALIDATION_ERRORs from Zod .strict() — only state conflicts
// (price change, insufficient stock, payment totals, duplicates) get a
// domain error factory. Mirrors routes/movimientos.ts's entradaBody
// precedent exactly.
const medioSchema = z.enum(['efectivo', 'tarjeta', 'transferencia', 'qr']);

const itemBody = z
  .object({
    productoId: z.string().uuid(),
    cantidad: z.number().int().min(1),
    precioUnitarioEsperado: z.string(),
  })
  .strict();

const pagoBody = z
  .object({
    medio: medioSchema,
    monto: z.string(),
  })
  .strict();

const confirmarVentaBody = z
  .object({
    items: z.array(itemBody).min(1),
    pagos: z.array(pagoBody).min(1),
  })
  .strict();

const itemVentaDto = z.object({
  id: z.string(),
  ventaId: z.string(),
  productoId: z.string(),
  cantidad: z.number().int(),
  precioUnitario: z.string(),
  subtotal: z.string(),
});

const pagoDto = z.object({
  id: z.string(),
  ventaId: z.string(),
  medio: medioSchema,
  monto: z.string(),
  vuelto: z.string(),
  estado: z.enum(['registrado', 'revertido']),
});

const ventaDto = z.object({
  id: z.string(),
  numeroCorrelativo: z.number().int(),
  usuarioId: z.string(),
  estado: z.enum(['confirmada', 'anulada']),
  total: z.string(),
  creadoEn: z.date(),
});

const okVenta = z.object({
  venta: ventaDto,
  items: z.array(itemVentaDto),
  pagos: z.array(pagoDto),
});

// recibo-interno (backlog #8) — design.md D1's per-file precedent, not
// shared (matches productos.ts:50, movimientos.ts:22, usuarios.ts:49,
// proveedores.ts:35).
const idParams = z.object({ id: z.string().uuid() });

const numeroCorrelativoParams = z.object({
  numeroCorrelativo: z.coerce.number().int().positive(),
});

// design.md's Interfaces/Contracts: `ventaDto` is REUSED as-is, never
// duplicated.
const reciboItemDto = itemVentaDto.extend({ nombre: z.string() });

const okRecibo = z.object({
  venta: ventaDto,
  cajero: z.object({ id: z.string(), nombre: z.string() }),
  items: z.array(reciboItemDto),
  pagos: z.array(pagoDto),
});

const catalogoProductoDto = z.object({
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

const paginatedCatalogo = z.object({
  data: z.array(catalogoProductoDto),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

function toVentaDto(venta: Venta) {
  return {
    id: venta.id,
    numeroCorrelativo: venta.numeroCorrelativo,
    usuarioId: venta.usuarioId,
    estado: venta.estado,
    total: venta.total,
    creadoEn: venta.creadoEn,
  };
}

function toItemVentaDto(item: ItemVenta) {
  return {
    id: item.id,
    ventaId: item.ventaId,
    productoId: item.productoId,
    cantidad: item.cantidad,
    precioUnitario: item.precioUnitario,
    subtotal: item.subtotal,
  };
}

function toPagoDto(pago: Pago) {
  return {
    id: pago.id,
    ventaId: pago.ventaId,
    medio: pago.medio as MedioPago,
    monto: pago.monto,
    vuelto: pago.vuelto,
    estado: pago.estado,
  };
}

function toReciboItemDto(item: ReciboItem) {
  return {
    id: item.id,
    ventaId: item.ventaId,
    productoId: item.productoId,
    cantidad: item.cantidad,
    precioUnitario: item.precioUnitario,
    subtotal: item.subtotal,
    nombre: item.nombre,
  };
}

function toCatalogoProductoDto(producto: Producto) {
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

const ventasRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // spec.md L39-41: confirming a sale is open to both roles, mirroring #6's
  // entrada/salida routes and docs/PRD.md:69-70 (depósito staff act as
  // cashiers).
  typed.post(
    '/ventas',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        body: confirmarVentaBody,
        response: {
          201: okVenta,
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
      const { venta, items, pagos } = await confirmarVenta(app.uow, {
        items: request.body.items,
        pagos: request.body.pagos,
        actor,
      });
      reply.status(201);
      return {
        venta: toVentaDto(venta),
        items: items.map(toItemVentaDto),
        pagos: pagos.map(toPagoDto),
      };
    },
  );

  // design.md D11/PD-8/PD-12: excludes inactive products entirely, includes
  // zero-stock active products, ordered alphabetically by nombre — a
  // POS-owned read, deliberately not the shipped GET /api/productos.
  typed.get(
    '/ventas/catalogo',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        querystring: pageQuerySchema,
        response: {
          200: paginatedCatalogo,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query;
      const { rows, total } = await app.repos.productos.list(
        page,
        pageSize,
        undefined,
        { soloActivos: true },
      );
      return paginated(rows.map(toCatalogoProductoDto), page, pageSize, total);
    },
  );

  // recibo-interno (backlog #8) — design.md D1: this is registered AFTER
  // `/ventas/catalogo` on purpose, so the route-shadowing RED test
  // (routes/ventas.test.ts) proves the static segment still wins under the
  // real registration order this file uses, not merely the order Fastify's
  // radix-tree matcher happens to prefer. `GET /ventas/numero/:n` (3
  // segments) cannot collide with either.
  typed.get(
    '/ventas/:id',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        params: idParams,
        response: {
          200: okRecibo,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const recibo = await getRecibo(app.repos, { id: request.params.id });
      return {
        venta: toVentaDto(recibo.venta),
        cajero: recibo.cajero,
        items: recibo.items.map(toReciboItemDto),
        pagos: recibo.pagos.map(toPagoDto),
      };
    },
  );

  typed.get(
    '/ventas/numero/:numeroCorrelativo',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        params: numeroCorrelativoParams,
        response: {
          200: okRecibo,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const recibo = await getRecibo(app.repos, {
        numeroCorrelativo: request.params.numeroCorrelativo,
      });
      return {
        venta: toVentaDto(recibo.venta),
        cajero: recibo.cajero,
        items: recibo.items.map(toReciboItemDto),
        pagos: recibo.pagos.map(toPagoDto),
      };
    },
  );
};

export default ventasRoutes;
