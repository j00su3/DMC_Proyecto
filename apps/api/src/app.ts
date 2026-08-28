import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import {
  type ZodTypeProvider,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { UnitOfWork } from './db/uow.js';
import { notFoundEnvelope, toErrorEnvelope } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import cookiePlugin from './plugins/cookie.js';
import dbPlugin, { type DbLike } from './plugins/db.js';
import reposPlugin, { type Repos } from './plugins/repos.js';
import authRoutes from './routes/auth.js';
import healthRoutes from './routes/health.js';
import usuariosRoutes from './routes/usuarios.js';

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
  uow?: UnitOfWork;
  cookieSecret?: string;
  rateLimitMax?: number;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Logging is OFF everywhere except production.
 *
 * It has to be on in production: `server.ts` reports a failed `listen()` with
 * `app.log.error(error)`, and with logging disabled Fastify installs a no-op
 * logger — the process would exit(1) having printed nothing at all, leaving a
 * dead service with no diagnostic. It has to stay off elsewhere because the
 * unit suite builds an app per test and would drown in request lines.
 *
 * `LOG_LEVEL` is read so the level can be turned up on a running deployment
 * without a redeploy.
 *
 * `process.env` is read directly rather than through `lib/env.ts`, matching
 * `plugins/cookie.ts`: importing that module here would require DATABASE_URL
 * at import time and drag Postgres into the unit suite (design.md D13).
 *
 * Note that Fastify's default logger records the request line, status and
 * timing — NOT request bodies — so enabling this does not put the login
 * password in the logs. Verified by probe, not assumed. Any future change that
 * starts logging bodies or error objects needs a `redact` list first.
 */
function defaultLogger(): FastifyServerOptions['logger'] {
  if (process.env.NODE_ENV !== 'production') {
    return false;
  }

  return { level: process.env.LOG_LEVEL ?? 'info' };
}

export async function buildApp(
  opts: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? defaultLogger(),
  }).withTypeProvider<ZodTypeProvider>();

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
  await app.register(reposPlugin, { repos: opts.repos, uow: opts.uow });
  // Must be registered before any route plugin below — Fastify hooks only
  // apply to routes registered after the hook (design.md risk register).
  await app.register(authPlugin);
  // global: false — rate limiting only applies to routes that opt in via
  // config.rateLimit (currently only POST /api/auth/login).
  await app.register(rateLimit, { global: false });
  app.decorate('rateLimitMax', opts.rateLimitMax ?? 10);

  app.register(healthRoutes, { prefix: '/api' });
  app.register(authRoutes, { prefix: '/api' });
  // After authPlugin, like every other route plugin — Fastify hooks apply
  // only to routes registered after the hook, so registering above it would
  // silently drop the default-deny guarantee for these routes.
  app.register(usuariosRoutes, { prefix: '/api' });

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
