import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  type ZodTypeProvider,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { notFoundEnvelope, toErrorEnvelope } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import cookiePlugin from './plugins/cookie.js';
import dbPlugin, { type DbLike } from './plugins/db.js';
import reposPlugin, { type Repos } from './plugins/repos.js';
import healthRoutes from './routes/health.js';

export interface BuildAppOptions {
  db?: DbLike;
  repos?: Repos;
  cookieSecret?: string;
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

  await app.register(cookiePlugin, { secret: opts.cookieSecret });
  await app.register(dbPlugin, { db: opts.db });
  await app.register(reposPlugin, { repos: opts.repos });
  // Must be registered before any route plugin below — Fastify hooks only
  // apply to routes registered after the hook (design.md risk register).
  await app.register(authPlugin);

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
