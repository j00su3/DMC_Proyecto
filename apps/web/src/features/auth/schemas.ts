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

const changePasswordFields = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});

const notSameAsCurrent = {
  message: 'La nueva contraseña no puede ser igual a la actual.',
  path: ['newPassword'],
};

/**
 * Client mirror of the server's `POST /api/auth/password` body
 * (`changePasswordBody` in `apps/api/src/routes/auth.ts`) — same shape, same
 * `.refine`, same message contract (design.md D5). This is the request body;
 * keep it exactly two fields.
 */
export const changePasswordSchema = changePasswordFields.refine(
  (value) => value.newPassword !== value.currentPassword,
  notSameAsCurrent,
);

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * What the FORM validates, which is deliberately wider than the request body.
 * The confirmation field exists purely client-side: this is the one screen
 * where a typo is irreversible, since a mistyped new password locks the user
 * out of their own account until an admin resets it. The server has no such
 * field and must never receive it — `ChangePasswordForm` strips it before
 * calling `onSubmit`.
 */
export const changePasswordFormSchema = changePasswordFields
  .extend({ confirmPassword: z.string().min(1) })
  .refine(
    (value) => value.newPassword !== value.currentPassword,
    notSameAsCurrent,
  )
  .refine((value) => value.confirmPassword === value.newPassword, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmPassword'],
  });

export type ChangePasswordFormInput = z.infer<typeof changePasswordFormSchema>;
