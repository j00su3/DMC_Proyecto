import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  type ZodTypeProvider,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { notFoundEnvelope, toErrorEnvelope } from './lib/errors.js';
import cookiePlugin from './plugins/cookie.js';
import dbPlugin, { type DbLike } from './plugins/db.js';
import healthRoutes from './routes/health.js';

export interface BuildAppOptions {
  db?: DbLike;
}

export async function buildApp(
  opts: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      info: {
        title: '@inventienda/api',
        version: '0.0.0',
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(cookiePlugin);
  await app.register(dbPlugin, { db: opts.db });

  app.register(healthRoutes, { prefix: '/api' });

  app.setErrorHandler((error, _request, reply) => {
    const { status, body } = toErrorEnvelope(error);
    if (status >= 500) {
      app.log.error(error);
    }
    reply.status(status).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const { status, body } = notFoundEnvelope();
    reply.status(status).send(body);
  });

  return app;
}
