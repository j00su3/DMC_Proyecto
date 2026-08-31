import { useCallback, useEffect, useReducer } from 'react';
import {
  type CarritoState,
  type ProductoParaCarrito,
  carritoReducer,
  initialCarritoState,
} from './carrito.js';
import { cargarCarrito, guardarCarrito } from './storage.js';

/** Lazy `useReducer` initializer — restores D14's persisted envelope (or an
 * empty cart, on any load failure) exactly once, on mount. */
function initCarritoState(usuarioId: string): CarritoState {
  return { ...initialCarritoState, items: cargarCarrito(usuarioId) };
}

/**
 * Wraps `carrito.ts`'s pure reducer with D14's storage side effects: loads
 * the persisted envelope for `usuarioId` on mount (`storage.ts`'s
 * `cargarCarrito`) and re-persists the current items after every dispatch
 * (`guardarCarrito`). Mirrors `features/movimientos/useRegistrarMovimiento`'s
 * shape — one hook per domain concern, parameterized by the id its caller
 * (PR8's `pos.tsx`, reading `usuario.id` from the route context) already
 * has.
 *
 * `usuarioId` is read only by the lazy initializer; this hook does not
 * re-load the cart if `usuarioId` changes on an already-mounted instance
 * (D14 scopes the cart key per user+device, but re-keying an existing
 * component instance is not a scenario this change needs — the route that
 * owns `usuario.id` does not change without a full remount).
 */
export function useCarrito(usuarioId: string) {
  const [state, dispatch] = useReducer(
    carritoReducer,
    usuarioId,
    initCarritoState,
  );

  useEffect(() => {
    guardarCarrito(usuarioId, state.items);
  }, [usuarioId, state.items]);

  const agregar = useCallback(
    (producto: ProductoParaCarrito, cantidad?: number) =>
      dispatch({ type: 'AGREGAR', producto, cantidad }),
    [],
  );

  const actualizarCantidad = useCallback(
    (productoId: string, cantidad: number) =>
      dispatch({ type: 'ACTUALIZAR_CANTIDAD', productoId, cantidad }),
    [],
  );

  const quitar = useCallback(
    (productoId: string) => dispatch({ type: 'QUITAR', productoId }),
    [],
  );

  // PD-9: explicit empty-cart action, also called by useConfirmarVenta.ts
  // on a successful sale.
  const vaciar = useCallback(() => dispatch({ type: 'VACIAR' }), []);

  return {
    items: state.items,
    bloqueoStock: state.bloqueoStock,
    agregar,
    actualizarCantidad,
    quitar,
    vaciar,
  };
}
