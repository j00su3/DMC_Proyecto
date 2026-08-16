import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';

const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptime: z.number(),
  db: z.enum(['up', 'down']),
});

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async (request) => {
      const dbUp = await request.server.db.checkDb();

      if (!dbUp) {
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          'Database is unreachable',
          503,
        );
      }

      return {
        status: 'ok' as const,
        uptime: process.uptime(),
        db: 'up' as const,
      };
    },
  );
};

export default healthRoutes;
