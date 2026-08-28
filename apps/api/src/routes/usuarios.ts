import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorEnvelopeSchema, unauthorized } from '../lib/errors.js';
import { pageQuerySchema, paginated } from '../lib/pagination.js';
import type { UsuarioResumen } from '../usuarios/repository.js';
import {
  createUsuario,
  getUsuario,
  listUsuarios,
  resetUsuarioPassword,
  setUsuarioActivo,
  updateUsuario,
} from '../usuarios/service.js';

// Its own DTO, deliberately NOT auth.ts's `usuarioDto` (D16). The two
// answer different questions — auth's describes the caller to itself and
// carries no `activo`, this one describes a managed user to an encargado —
// and sharing it would couple two contracts that are free to diverge.
//
// The hash is kept out of responses by TWO independent layers, and it is
// worth being precise about which one runs: the Zod response schema strips
// unknown keys during serialisation, and `toDto` below builds an explicit
// object. Measured, not assumed — with the schema strict, replacing `toDto`
// with a spread changes no output; with `toDto` explicit, loosening the
// schema to `.passthrough()` changes no output; only removing BOTH lets a
// hash through, and the leak test catches that. So neither is "the" guard.
// Keep both: this is the response boundary of a user-management API, and
// defence in depth is cheap here.
const usuarioResumenDto = z.object({
  id: z.string(),
  nombre: z.string(),
  email: z.string(),
  rol: z.enum(['encargado', 'deposito']),
  activo: z.boolean(),
  debeCambiarPassword: z.boolean(),
  creadoEn: z.date(),
});

const okUsuario = z.object({ usuario: usuarioResumenDto });

const paginatedUsuarios = z.object({
  data: z.array(usuarioResumenDto),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

const idParams = z.object({ id: z.string().uuid() });

const crearUsuarioBody = z.object({
  nombre: z.string().min(1),
  email: z.string().email(),
  rol: z.enum(['encargado', 'deposito']),
});

// Disjoint from `usuarioResumenDto` on purpose (D8). The plaintext is a key
// that exists on exactly two responses in the whole API, and keeping it in
// its own schema is what makes that checkable rather than a convention —
// an optional field on the shared DTO would put it one careless spread away
// from every read route.
const usuarioConPasswordDto = z.object({
  usuario: usuarioResumenDto,
  passwordTemporal: z.string(),
});

// `.strict()` is the load-bearing part, not `.partial()` (D13). Deactivation
// is its own route precisely so the audit verb is never derived from a patch
// shape — a body carrying both `nombre` and `activo` would force either two
// audit rows for one transaction or a lossy choice of verb, and the lossy
// choice destroys the indexed equality filter the verbs exist for. Rejecting
// the key makes that request unreachable rather than merely discouraged, and
// it fails at the Zod layer before any handler runs.
//
// The refine is what stops an empty body: `{}` satisfies every optional
// field, would produce an empty diff, and would answer 200 having done
// nothing — a success code for a request that expressed no intent.
const actualizarUsuarioBody = z
  .object({
    nombre: z.string().min(1).optional(),
    email: z.string().email().optional(),
    rol: z.enum(['encargado', 'deposito']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one of nombre, email or rol is required',
  });

function toDto(usuario: UsuarioResumen) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    activo: usuario.activo,
    debeCambiarPassword: usuario.debeCambiarPassword,
    creadoEn: usuario.creadoEn,
  };
}

// `request.user` is typed nullable because the RBAC hook decorates it for
// every request, including the ones it lets through unauthenticated. On a
// route carrying `roles: ['encargado']` the hook has already thrown 403 for
// a null user, so this is an unreachable branch — but it is the actor id
// that ends up in the audit trail, and a silent `?? ''` there would write a
// row that names nobody.
function requireActorId(user: { id: string } | null): string {
  if (!user) {
    throw unauthorized();
  }
  return user.id;
}

const usuariosRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // Reads go through `app.repos`, not `app.uow` (D17): a single SELECT pair
  // needs no transaction, and wrapping it would take a pooled connection
  // out of circulation for no guarantee it does not already have.
  typed.get(
    '/usuarios',
    {
      config: { roles: ['encargado'] },
      schema: {
        querystring: pageQuerySchema,
        response: {
          200: paginatedUsuarios,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query;
      const { rows, total } = await listUsuarios(app.repos, { page, pageSize });
      return paginated(rows.map(toDto), page, pageSize, total);
    },
  );

  typed.get(
    '/usuarios/:id',
    {
      config: { roles: ['encargado'] },
      schema: {
        params: idParams,
        response: {
          200: okUsuario,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      // USER_NOT_FOUND, not the app-wide NOT_FOUND: the route matched and
      // the row did not, which is what tells the SPA whether it called a
      // wrong URL or asked for a user that is gone.
      const usuario = await getUsuario(app.repos, request.params.id);
      return { usuario: toDto(usuario) };
    },
  );

  typed.post(
    '/usuarios',
    {
      config: { roles: ['encargado'] },
      schema: {
        body: crearUsuarioBody,
        response: {
          201: usuarioConPasswordDto,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const actorId = requireActorId(request.user);
      const { usuario, passwordTemporal } = await createUsuario(app.uow, {
        ...request.body,
        actorId,
      });
      // The plaintext leaves here and nowhere else, so nothing downstream
      // may keep a copy — browser, proxy or CDN (D8).
      reply.header('Cache-Control', 'no-store');
      reply.status(201);
      return { usuario: toDto(usuario), passwordTemporal };
    },
  );

  typed.post(
    '/usuarios/:id/password-reset',
    {
      config: { roles: ['encargado'] },
      schema: {
        params: idParams,
        response: {
          200: usuarioConPasswordDto,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const actorId = requireActorId(request.user);
      const { usuario, passwordTemporal } = await resetUsuarioPassword(
        app.uow,
        { id: request.params.id, actorId },
      );
      reply.header('Cache-Control', 'no-store');
      return { usuario: toDto(usuario), passwordTemporal };
    },
  );

  typed.patch(
    '/usuarios/:id',
    {
      config: { roles: ['encargado'] },
      schema: {
        params: idParams,
        body: actualizarUsuarioBody,
        response: {
          200: okUsuario,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const actorId = requireActorId(request.user);
      const usuario = await updateUsuario(app.uow, {
        id: request.params.id,
        cambios: request.body,
        actorId,
      });
      return { usuario: toDto(usuario) };
    },
  );

  // Two explicit routes rather than one PATCH carrying `activo` (D13). The
  // path names the transition, so the audit verb is decided by which URL was
  // called, not inferred from a diff.
  for (const [segment, activo] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    typed.post(
      `/usuarios/:id/${segment}`,
      {
        config: { roles: ['encargado'] },
        schema: {
          params: idParams,
          response: {
            200: okUsuario,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        const actorId = requireActorId(request.user);
        const usuario = await setUsuarioActivo(app.uow, {
          id: request.params.id,
          activo,
          actorId,
        });
        return { usuario: toDto(usuario) };
      },
    );
  }
};

export default usuariosRoutes;
