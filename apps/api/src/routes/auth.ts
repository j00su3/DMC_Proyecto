import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { changePassword, login, logout } from '../auth/service.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../auth/session.js';
import { errorEnvelopeSchema, unauthorized } from '../lib/errors.js';
import { resolveSessionRateLimitKey } from '../plugins/sessionRateLimit.js';

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12),
  })
  // Falls through to VALIDATION_ERROR via the shared Zod error handler — no
  // dedicated code for "same password" per the Interfaces section.
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'newPassword must differ from currentPassword',
    path: ['newPassword'],
  });

const usuarioDto = z.object({
  id: z.string(),
  nombre: z.string(),
  email: z.string(),
  rol: z.enum(['encargado', 'deposito']),
  debeCambiarPassword: z.boolean(),
});

const okUsuario = z.object({ usuario: usuarioDto });

function toDto(usuario: {
  id: string;
  nombre: string;
  email: string;
  rol: 'encargado' | 'deposito';
  debeCambiarPassword: boolean;
}) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    debeCambiarPassword: usuario.debeCambiarPassword,
  };
}

const authRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/auth/login',
    {
      config: {
        auth: false,
        rateLimit: { max: app.rateLimitMax, timeWindow: '1 minute' },
      },
      schema: {
        body: loginBody,
        response: {
          200: okUsuario,
          401: errorEnvelopeSchema,
          423: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const { usuario, token } = await login(app.repos, request.body);
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions());
      return { usuario: toDto(usuario) };
    },
  );

  typed.post(
    '/auth/logout',
    {
      config: { auth: false },
      schema: {
        response: {
          200: z.object({ ok: z.literal(true) }),
        },
      },
    },
    async (request, reply) => {
      const raw = request.cookies[SESSION_COOKIE];
      if (raw) {
        const unsigned = request.unsignCookie(raw);
        if (unsigned.valid && unsigned.value) {
          await logout(app.repos, unsigned.value);
        }
      }
      reply.clearCookie(SESSION_COOKIE, sessionCookieOptions());
      return { ok: true as const };
    },
  );

  typed.get(
    '/auth/me',
    {
      // Opts in to the forced-change allowlist (design.md D3): the SPA needs
      // to read the flag from here to route to the change-password screen.
      config: { allowPasswordChangePending: true },
      schema: {
        response: {
          200: okUsuario,
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      // The onRequest hook already resolved request.user for protected
      // routes; resolveSession here is only a defensive re-check in case a
      // future refactor drops the guarantee.
      if (!request.user) {
        throw unauthorized();
      }
      return { usuario: toDto(request.user) };
    },
  );

  typed.post(
    '/auth/password',
    {
      // Opts in to the forced-change allowlist (design.md D3): this is the
      // only route a flagged user can reach to clear the flag.
      //
      // SECURITY-REPORT.md S02: runs TWO full-cost argon2 operations per
      // request (verify + hash) and is reachable by any authenticated
      // session, including the lowest-privilege `deposito` role. Keyed by
      // session (sessionRateLimit.ts), not IP — S12 leaves real-IP
      // resolution only partially verifiable, and this route always has a
      // resolved session by the time the rate-limit hook runs.
      config: {
        allowPasswordChangePending: true,
        rateLimit: {
          max: app.rateLimitMax,
          timeWindow: '1 minute',
          keyGenerator: (request) =>
            resolveSessionRateLimitKey(request.user, request.ip),
        },
      },
      schema: {
        body: changePasswordBody,
        response: {
          200: z.object({ ok: z.literal(true) }),
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      // The onRequest hook already resolved request.user/sessionId for
      // protected routes; defensive re-check for the same reason as /me.
      if (!request.user) {
        throw unauthorized();
      }
      await changePassword(app.uow, {
        usuario: request.user,
        sessionId: request.sessionId ?? '',
        currentPassword: request.body.currentPassword,
        newPassword: request.body.newPassword,
      });
      return { ok: true as const };
    },
  );
};

export default authRoutes;
