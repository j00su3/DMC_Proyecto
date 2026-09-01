import { z } from 'zod';

/**
 * Web's own copy of the ratified server-side bound
 * (`apps/api/src/ventas/service.ts`'s `anularVenta` guard, mirroring
 * `movimientos/service.ts`'s `MOTIVO_MIN_LENGTH`/`MOTIVO_MAX_LENGTH`).
 * design.md's Open Questions: `motivoAnulacion` = `trim().min(3).max(500)`,
 * ratified 2026-09-01. No cross-workspace import precedent
 * (`features/movimientos/schemas.ts:6-27` hardcodes the same numbers), so
 * this follows that same convention rather than sharing a package.
 */
export const MOTIVO_ANULACION_MIN_LENGTH = 3;
export const MOTIVO_ANULACION_MAX_LENGTH = 500;

/**
 * Form-only schema for `AnularVentaModal` (Phase 7). Unlike
 * `movimientoFormSchema`, `motivoAnulacion` is *unconditionally* required —
 * no `superRefine` branching by choice, since anulación has exactly one
 * shape (point-of-sale spec: "Motivo Anulación Is Mandatory (PD-1)").
 */
export const anularVentaFormSchema = z.object({
  motivoAnulacion: z
    .string()
    .trim()
    .min(
      MOTIVO_ANULACION_MIN_LENGTH,
      `Ingrese un motivo (mínimo ${MOTIVO_ANULACION_MIN_LENGTH} caracteres).`,
    )
    .max(
      MOTIVO_ANULACION_MAX_LENGTH,
      `Máximo ${MOTIVO_ANULACION_MAX_LENGTH} caracteres.`,
    ),
});

export type AnularVentaFormValues = z.infer<typeof anularVentaFormSchema>;

export const EMPTY_ANULAR_VENTA_FORM: AnularVentaFormValues = {
  motivoAnulacion: '',
};
