import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Usuario } from '../auth/repository.js';
import { SESSION_COOKIE } from '../auth/session.js';
import { forbidden, unauthorized } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    // Opts a route out of the default-deny hook (design.md D7).
    auth?: false;
    // Role allowlist checked by the preHandler hook once request.user exists.
    roles?: Array<Usuario['rol']>;
  }

  interface FastifyRequest {
    user: Usuario | null;
  }
}

// Default-deny RBAC enforcement (design.md D7/D8). Registration order in
// app.ts matters: Fastify hooks only apply to routes registered AFTER the
// hook is added, so this plugin MUST be registered before any route plugin
// (healthRoutes, future authRoutes, etc.) or the default-deny guarantee
// silently stops covering those routes.
export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    // Unmatched routes never resolved route config; skip so the
    // notFoundHandler still produces 404 instead of a false 401 (D8).
    if (request.routeOptions.url === undefined) {
      return;
    }

    if (request.routeOptions.config.auth === false) {
      return;
    }

    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) {
      throw unauthorized();
    }

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) {
      throw unauthorized();
    }

    const usuario = await app.repos.sesiones.findValid(
      unsigned.value,
      new Date(),
    );
    if (!usuario) {
      throw unauthorized();
    }

    request.user = usuario;
  });

  app.addHook('preHandler', async (request) => {
    if (request.routeOptions.url === undefined) {
      return;
    }

    if (request.routeOptions.config.auth === false) {
      return;
    }

    const roles = request.routeOptions.config.roles;
    if (roles && (!request.user || !roles.includes(request.user.rol))) {
      throw forbidden();
    }
  });
});
