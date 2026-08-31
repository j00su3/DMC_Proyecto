import { z } from 'zod';

/**
 * Web's own copy of `apps/api/src/movimientos/service.ts:15`'s
 * `MOTIVO_MIN_LENGTH = 3` (RECONCILE-2). No existing precedent imports a
 * constant across the `apps/api` / `apps/web` workspace boundary
 * (`features/productos/schemas.ts` hardcodes its own numbers), so this
 * follows that convention rather than inventing a shared package. The API
 * constant remains the source of truth — keep both in sync if it changes.
 */
export const MOTIVO_MIN_LENGTH = 3;

/**
 * Mirrors the API's `max(500)` on `motivoSchema`
 * (`apps/api/src/routes/movimientos.ts:27-32`), which applies to the body of
 * all three write routes.
 *
 * Unlike the minimum, this ceiling is unconditional: it holds for every
 * `eleccion`, including the ones where `motivo` is optional. The server has
 * always enforced it, but until the claims gate caught the gap
 * (`openspec/changes/movimientos-inventario/claims-report.md`, refuted claim
 * 10) the form did not, so an over-long motivo was refused only after a round
 * trip, as a generic `VALIDATION_ERROR` naming no limit.
 */
export const MOTIVO_MAX_LENGTH = 500;

/**
 * Form-only: raw strings off `<input>`/`<select>`, parsed once at submit.
 * Follows `productoFormSchema`'s precedent (`features/productos/schemas.ts`).
 *
 * `eleccion` carries the four operator-facing choices D9 (§Step 1)
 * describes; the wire only knows three `tipo` values (`entrada`, `salida`,
 * `ajuste`) — `merma` is a `salida` with `esMerma: true`. That mapping
 * happens at submit time (S7a/S7b), not in this schema.
 *
 * The `superRefine` below is D8's client-side echo of the service guard:
 * `motivo` is required only for `ajuste` and merma `salida`s. The server
 * remains the authoritative boundary — see D9's PD-2 note.
 */
export const movimientoFormSchema = z
  .object({
    eleccion: z.enum(['entrada', 'salida', 'merma', 'ajuste']),
    cantidad: z
      .string()
      .trim()
      .regex(/^\d+$/, 'Ingrese una cantidad válida.')
      .refine((v) => Number(v) >= 1, 'La cantidad debe ser al menos 1.'),
    direccion: z.enum(['sumar', 'restar']),
    esDiscrepancia: z.boolean(),
    motivo: z
      .string()
      .trim()
      .max(MOTIVO_MAX_LENGTH, `Máximo ${MOTIVO_MAX_LENGTH} caracteres.`),
  })
  .superRefine((v, ctx) => {
    if (
      (v.eleccion === 'ajuste' || v.eleccion === 'merma') &&
      v.motivo.length < MOTIVO_MIN_LENGTH
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['motivo'],
        message: `Ingrese un motivo (mínimo ${MOTIVO_MIN_LENGTH} caracteres).`,
      });
    }
  });

export type MovimientoFormValues = z.infer<typeof movimientoFormSchema>;

export const EMPTY_MOVIMIENTO_FORM: MovimientoFormValues = {
  eleccion: 'entrada',
  cantidad: '',
  direccion: 'sumar',
  esDiscrepancia: false,
  motivo: '',
};
