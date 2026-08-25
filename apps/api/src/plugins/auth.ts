import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Usuario } from '../auth/repository.js';
import { SESSION_COOKIE } from '../auth/session.js';
import {
  forbidden,
  passwordChangeRequired,
  unauthorized,
} from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    // Opts a route out of the default-deny hook (design.md D7).
    auth?: false;
    // Role allowlist checked by the preHandler hook once request.user exists.
    roles?: Array<Usuario['rol']>;
    // Opt-in allowlist for a forced-change user (design.md D3): default-deny,
    // exactly two routes need this — GET /auth/me and POST /auth/password.
    allowPasswordChangePending?: true;
  }

  interface FastifyRequest {
    user: Usuario | null;
    // The unsigned session cookie value (== sesiones.id), set in onRequest so
    // handlers never re-derive it from the raw cookie (design.md D8).
    sessionId: string | null;
  }
}

// Default-deny RBAC enforcement (design.md D7/D8). Registration order in
// app.ts matters: Fastify hooks only apply to routes registered AFTER the
// hook is added, so this plugin MUST be registered before any route plugin
// (healthRoutes, future authRoutes, etc.) or the default-deny guarantee
// silently stops covering those routes.
export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

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
    request.sessionId = unsigned.value;
  });

  app.addHook('preHandler', async (request) => {
    if (request.routeOptions.url === undefined) {
      return;
    }

    if (request.routeOptions.config.auth === false) {
      return;
    }

    // Forced-change check runs before the roles check (design.md D2): the
    // reachable set for a flagged user is exactly the opt-in allowlist,
    // regardless of role, and the SPA gets one deterministic code instead of
    // a role-dependent one.
    if (
      request.user?.debeCambiarPassword &&
      !request.routeOptions.config.allowPasswordChangePending
    ) {
      throw passwordChangeRequired();
    }

    const roles = request.routeOptions.config.roles;
    if (roles && (!request.user || !roles.includes(request.user.rol))) {
      throw forbidden();
    }
  });
});
