import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  type ActividadRecienteItem,
  obtenerResumen,
} from '../dashboard/service.js';
import { errorEnvelopeSchema } from '../lib/errors.js';

// design.md D3/D4: one bare-GET route (mirrors `/alertas/conteo`'s
// sub-resource naming), no querystring schema at all, no requireActor() call
// — decision 2 is unfiltered for both roles, no actor-scoping.

const movimientoRecienteDto = z.object({
  id: z.string(),
  productoId: z.string(),
  productoNombre: z.string(),
  tipo: z.enum(['entrada', 'salida', 'ajuste', 'venta', 'anulacion']),
  fecha: z.date(),
  usuarioId: z.string(),
});

const dashboardResumenDto = z.object({
  quiebres: z.number().int(),
  stockBajo: z.number().int(),
  alertasActivas: z.number().int(),
  actividadReciente: z.array(movimientoRecienteDto),
});

function toActividadRecienteDto(item: ActividadRecienteItem) {
  return {
    id: item.id,
    productoId: item.productoId,
    productoNombre: item.productoNombre,
    tipo: item.tipo,
    fecha: item.fecha,
    usuarioId: item.usuarioId,
  };
}

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/dashboard/resumen',
    {
      config: { roles: ['encargado', 'deposito'] },
      schema: {
        response: {
          200: dashboardResumenDto,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async () => {
      const resumen = await obtenerResumen(app.repos);
      return {
        quiebres: resumen.quiebres,
        stockBajo: resumen.stockBajo,
        alertasActivas: resumen.alertasActivas,
        actividadReciente: resumen.actividadReciente.map(
          toActividadRecienteDto,
        ),
      };
    },
  );
};

export default dashboardRoutes;
