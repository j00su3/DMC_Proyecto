import helmet from '@fastify/helmet';
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
import { resolveRateLimitKey } from './plugins/clientIp.js';
import cookiePlugin from './plugins/cookie.js';
import dbPlugin, { type DbLike } from './plugins/db.js';
import reposPlugin, { type Repos } from './plugins/repos.js';
import alertasRoutes from './routes/alertas.js';
import authRoutes from './routes/auth.js';
import healthRoutes from './routes/health.js';
import movimientosRoutes from './routes/movimientos.js';
import productosRoutes from './routes/productos.js';
import proveedoresRoutes from './routes/proveedores.js';
import reportesRoutes from './routes/reportes.js';
import usuariosRoutes from './routes/usuarios.js';
import ventasRoutes from './routes/ventas.js';

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

  // SECURITY-REPORT.md S03: neither the API nor the SPA emitted any HTTP
  // security header. CSP is deliberately strict — this is a pure JSON API,
  // nothing here ever serves or needs a runtime script. frame-ancestors
  // 'none' is the clickjacking control the report calls out explicitly;
  // @fastify/helmet's other defaults (noSniff -> X-Content-Type-Options,
  // frameguard, hsts, …) come along for free as extra defense in depth.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'same-origin' },
  });
  await app.register(cookiePlugin, { secret: opts.cookieSecret });
  await app.register(dbPlugin, { db: opts.db });
  await app.register(reposPlugin, { repos: opts.repos, uow: opts.uow });
  // Must be registered before any route plugin below — Fastify hooks only
  // apply to routes registered after the hook (design.md risk register).
  await app.register(authPlugin);
  // SECURITY-REPORT.md S04: every authenticated response except the two that
  // already set it explicitly (POST /usuarios, POST /usuarios/:id/password-reset)
  // left Cache-Control unset. Setting it here for every response, then letting
  // those two routes' own `reply.header('Cache-Control', 'no-store')` calls run
  // as before, is idempotent — same header, same value, either order. Routes
  // that opt out of auth (`config: { auth: false }`, e.g. GET /api/health,
  // POST /api/auth/login) are excluded: they carry nothing session-specific to
  // protect from an intermediate cache.
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.routeOptions.config?.auth === false) {
      return payload;
    }
    reply.header('Cache-Control', 'no-store');
    return payload;
  });
  // global: false — rate limiting only applies to routes that opt in via
  // config.rateLimit (currently only POST /api/auth/login).
  // SEC-003. `trustProxy` stays OFF deliberately: the Render origin is
  // publicly reachable, so X-Forwarded-For is attacker-controlled, and after
  // SEC-001's fix this rate limit is the only brake left on password
  // guessing — a spoofable key would be worse than the shared bucket it
  // replaces. The forwarded address is trusted only alongside the shared
  // secret, and falls back to the socket address in every other case, so a
  // missing or misconfigured secret degrades to today's behaviour instead of
  // rejecting traffic. See plugins/clientIp.ts.
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      resolveRateLimitKey(
        request.headers,
        request.ip,
        process.env.PROXY_SHARED_SECRET,
      ),
  });
  app.decorate('rateLimitMax', opts.rateLimitMax ?? 10);

  app.register(healthRoutes, { prefix: '/api' });
  app.register(authRoutes, { prefix: '/api' });
  // After authPlugin, like every other route plugin — Fastify hooks apply
  // only to routes registered after the hook, so registering above it would
  // silently drop the default-deny guarantee for these routes.
  app.register(usuariosRoutes, { prefix: '/api' });
  app.register(proveedoresRoutes, { prefix: '/api' });
  app.register(productosRoutes, { prefix: '/api' });
  // design.md D5: shares the `/productos/*` prefix segment with
  // productosRoutes above — the only place in the project where two
  // plugins own paths under the same segment (`/productos/:id` vs.
  // `/productos/:id/movimientos*`). Fastify resolves them as distinct
  // paths, so the split ownership is legal.
  app.register(movimientosRoutes, { prefix: '/api' });
  app.register(ventasRoutes, { prefix: '/api' });
  app.register(alertasRoutes, { prefix: '/api' });
  // design.md D5 (backlog #12): four read-only report routes, own file, no
  // shared prefix segment with any other route plugin.
  app.register(reportesRoutes, { prefix: '/api' });

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
