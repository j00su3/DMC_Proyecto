import { z } from 'zod';

/**
 * Client mirror of the server's `POST /api/auth/login` body (`loginBody` in
 * `apps/api/src/routes/auth.ts`) — same shape, same validation rules.
 */
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Client mirror of the server's `POST /api/auth/password` body
 * (`changePasswordBody` in `apps/api/src/routes/auth.ts`) — same shape, same
 * `.refine`, same message contract (design.md D5).
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12),
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'La nueva contraseña no puede ser igual a la actual.',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
