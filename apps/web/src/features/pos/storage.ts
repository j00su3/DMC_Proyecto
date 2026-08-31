import type { CarritoLinea } from './carrito.js';
import { carritoStorageEnvelopeSchema } from './schemas.js';

/**
 * design.md D14 (amended by `proposal.md` PD-14): a cart is discarded if it
 * has not been saved-to in this long. 4 hours — long enough to survive a
 * shift's normal interruptions, short enough that a stale price snapshot
 * does not linger for a next-day session on a shared terminal.
 */
export const CART_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * D14: one versioned envelope per user+device. Scoping by `usuarioId` (not
 * just the device) is what spec.md L40-56 requires — a different
 * signed-in user on the same browser never sees another user's cart.
 */
export function claveCarrito(usuarioId: string): string {
  return `inventienda.pos.carrito.v1.${usuarioId}`;
}

function borrarCarrito(usuarioId: string): void {
  try {
    window.localStorage.removeItem(claveCarrito(usuarioId));
  } catch {
    // Storage unavailable — nothing left to clean up; degrade silently
    // (D14), same rule as guardarCarrito's write path below.
  }
}

/**
 * D14's load path: `JSON.parse` in `try/catch` → Zod `safeParse` against the
 * envelope shape → TTL check → on ANY failure, delete the key and return an
 * empty cart. Never throws — spec.md L58-66 requires the POS screen to
 * render normally with an empty cart on any unparseable/incompatible value.
 */
export function cargarCarrito(usuarioId: string): CarritoLinea[] {
  const clave = claveCarrito(usuarioId);

  let crudo: string | null;
  try {
    crudo = window.localStorage.getItem(clave);
  } catch {
    return [];
  }

  if (crudo === null) {
    return [];
  }

  let parseado: unknown;
  try {
    parseado = JSON.parse(crudo);
  } catch {
    borrarCarrito(usuarioId);
    return [];
  }

  const resultado = carritoStorageEnvelopeSchema.safeParse(parseado);
  if (!resultado.success) {
    borrarCarrito(usuarioId);
    return [];
  }

  const { items, savedAt } = resultado.data;
  if (Date.now() - savedAt > CART_TTL_MS) {
    borrarCarrito(usuarioId);
    return [];
  }

  return items;
}

/**
 * D14's write path: `savedAt` is rewritten to `Date.now()` on every call —
 * callers pass the full current cart, not a delta. Wrapped in `try/catch`
 * so a quota error (or storage being unavailable at all) degrades to
 * in-memory-only state instead of throwing out of a reducer dispatch.
 */
export function guardarCarrito(usuarioId: string, items: CarritoLinea[]): void {
  const envelope = { v: 1 as const, items, savedAt: Date.now() };

  try {
    window.localStorage.setItem(
      claveCarrito(usuarioId),
      JSON.stringify(envelope),
    );
  } catch {
    // Quota exceeded or storage unavailable — degrade to memory (D14).
  }
}
