import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { login, logout } from '../auth/service.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../auth/session.js';
import { errorEnvelopeSchema, unauthorized } from '../lib/errors.js';

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const usuarioDto = z.object({
  id: z.string(),
  nombre: z.string(),
  email: z.string(),
  rol: z.enum(['encargado', 'deposito']),
});

const okUsuario = z.object({ usuario: usuarioDto });

function toDto(usuario: {
  id: string;
  nombre: string;
  email: string;
  rol: 'encargado' | 'deposito';
}) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
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
};

export default authRoutes;
