import { z } from 'zod';

/**
 * Client mirror of `apps/api/src/routes/ventas.ts:26`'s `medioSchema`. Wire
 * enum, English/Spanish mix follows `MedioPago` verbatim
 * (`apps/api/src/ventas/repository.ts`, TECH-DESIGNv2.md:154) — payment
 * medium values are domain data, not a code, so the two-naming-families
 * rule (CLAUDE.md) does not apply here.
 */
export const medioPagoSchema = z.enum([
  'efectivo',
  'tarjeta',
  'transferencia',
  'qr',
]);
export type MedioPago = z.infer<typeof medioPagoSchema>;

/**
 * Wire mirror of `apps/api/src/routes/ventas.ts:28-34`'s `itemBody`
 * (`.strict()`, same three keys). `precioUnitarioEsperado` is D5's price
 * authority field — the client always sends what the cashier last saw
 * (D15's `precioSnapshot`); the server never trusts it, only compares
 * against it.
 */
export const itemVentaInputSchema = z
  .object({
    productoId: z.string().uuid(),
    cantidad: z.number().int().min(1),
    precioUnitarioEsperado: z.string(),
  })
  .strict();
export type ItemVentaInput = z.infer<typeof itemVentaInputSchema>;

/** Wire mirror of `apps/api/src/routes/ventas.ts:36-41`'s `pagoBody`. */
export const pagoInputSchema = z
  .object({
    medio: medioPagoSchema,
    monto: z.string(),
  })
  .strict();
export type PagoInput = z.infer<typeof pagoInputSchema>;

/**
 * Full `POST /api/ventas` body, mirroring
 * `apps/api/src/routes/ventas.ts:43-48`'s `confirmarVentaBody`. Built and
 * sent by the PR9 `useConfirmarVenta` mutation — not used by this PR's
 * reducer/storage, but declared here so schemas.ts is the single source of
 * the wire shape (design.md's "wire schemas" task 5.1).
 */
export const confirmarVentaInputSchema = z
  .object({
    items: z.array(itemVentaInputSchema).min(1),
    pagos: z.array(pagoInputSchema).min(1),
  })
  .strict();
export type ConfirmarVentaInput = z.infer<typeof confirmarVentaInputSchema>;

/**
 * D15: one cart line carries a price *snapshot* — "what the cashier saw" —
 * used for display and, at confirmation, resent verbatim as
 * `precioUnitarioEsperado`. `stockActual` is D-13's UX-only snapshot: the
 * reducer uses it to block add/edit past available stock, but it can go
 * stale (another terminal sells the same product first) and the server's
 * `INSUFFICIENT_STOCK` check at confirmation remains the sole authority
 * (design.md D-13 resolution).
 */
export const carritoLineaSchema = z.object({
  productoId: z.string().uuid(),
  nombre: z.string(),
  sku: z.string(),
  precioSnapshot: z.string(),
  cantidad: z.number().int().min(1),
  stockActual: z.number().int().min(0),
});
export type CarritoLinea = z.infer<typeof carritoLineaSchema>;

/**
 * D14 (amended): the versioned envelope persisted at
 * `inventienda.pos.carrito.v1.<usuarioId>`. `v` is a literal `1` so a future
 * incompatible shape fails this schema outright (and is discarded, per
 * `storage.ts`) rather than being coerced. `savedAt` is a `Date.now()`
 * epoch-ms integer, rewritten on every mutation, and checked against
 * `CART_TTL_MS` (4h, PD-14) by `storage.ts` — the schema only validates the
 * shape, not the age.
 */
export const carritoStorageEnvelopeSchema = z.object({
  v: z.literal(1),
  items: z.array(carritoLineaSchema),
  savedAt: z.number().int().nonnegative(),
});
export type CarritoStorageEnvelope = z.infer<
  typeof carritoStorageEnvelopeSchema
>;
