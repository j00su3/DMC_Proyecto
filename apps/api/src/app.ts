import rateLimit from '@fastify/rate-limit';
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
import authRoutes from './routes/auth.js';
import healthRoutes from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    // Configurable per-instance login rate limit (design.md's contract
    // shows max: 10/minute in production; tests override to max: 1 to
    // exercise the real @fastify/rate-limit plugin, not the error builder).
    rateLimitMax: number;
  }
}

export interface BuildAppOptions {
  db?: DbLike;
  repos?: Repos;
  cookieSecret?: string;
  rateLimitMax?: number;
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
  // global: false — rate limiting only applies to routes that opt in via
  // config.rateLimit (currently only POST /api/auth/login).
  await app.register(rateLimit, { global: false });
  app.decorate('rateLimitMax', opts.rateLimitMax ?? 10);

  app.register(healthRoutes, { prefix: '/api' });
  app.register(authRoutes, { prefix: '/api' });

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
