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
