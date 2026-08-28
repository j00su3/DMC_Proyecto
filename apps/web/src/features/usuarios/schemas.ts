import { z } from 'zod';

/**
 * Client mirror of the server's `PATCH /api/usuarios/:id` body
 * (`actualizarUsuarioBody` in `apps/api/src/routes/usuarios.ts:78-87`) — same
 * three optional fields, same `.strict()` (no `activo` key, ever — that field
 * is exclusively managed by the deactivate/reactivate actions), same
 * "at least one field" refine. `useActualizarUsuario` builds its request body
 * from `formState.dirtyFields` (D18), so an all-optional shape is the correct
 * mirror even though the actual PATCH body is never empty in practice.
 */
export const actualizarUsuarioSchema = z
  .object({
    nombre: z.string().min(1).optional(),
    email: z.string().email().optional(),
    rol: z.enum(['encargado', 'deposito']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Debe modificar al menos un campo.',
  });

export type ActualizarUsuarioInput = z.infer<typeof actualizarUsuarioSchema>;

/**
 * What the FORM validates — always the full `{ nombre, email, rol }` triple,
 * since `UsuarioForm` always renders all three fields populated from the
 * current user. `useActualizarUsuario`'s caller narrows this down to only
 * the dirty subset (D18) before it becomes the PATCH body.
 */
export const usuarioFormSchema = z.object({
  nombre: z.string().min(1),
  email: z.string().email(),
  rol: z.enum(['encargado', 'deposito']),
});

export type UsuarioFormInput = z.infer<typeof usuarioFormSchema>;

/**
 * Client mirror of the server's `POST /api/usuarios` body (`crearUsuarioBody`
 * in `apps/api/src/routes/usuarios.ts:60-64`) — same three required fields,
 * verified against `useCrearUsuario.test.ts`'s request-body assertion.
 */
export const crearUsuarioSchema = z.object({
  nombre: z.string().min(1),
  email: z.string().email(),
  rol: z.enum(['encargado', 'deposito']),
});

export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>;
