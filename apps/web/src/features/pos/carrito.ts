import type { CarritoLinea } from './schemas.js';

export type { CarritoLinea };

/**
 * design.md D-13/PD-13: `stockActual` is a UX-only snapshot, not the
 * server's authority. `AGREGAR` refuses to merge a quantity that would
 * exceed it — the pure reducer is the "help" the resolved product decision
 * asks for; `INSUFFICIENT_STOCK` at confirmation remains the real gate
 * regardless of what this reducer allows.
 */
export interface CarritoState {
  items: CarritoLinea[];
  /**
   * The `productoId` whose most recent AGREGAR/ACTUALIZAR_CANTIDAD attempt
   * was refused for exceeding `stockActual`, or `null` when the last
   * dispatched action was not blocked. Any other action clears it — it is
   * a transient signal for the UI's "sin stock disponible" affordance
   * (spec.md's PD-13 requirement), not part of the persisted cart shape.
   */
  bloqueoStock: string | null;
}

export const initialCarritoState: CarritoState = {
  items: [],
  bloqueoStock: null,
};

/** The catalog-facing shape `AGREGAR` accepts — mirrors the POS catalog DTO
 * (`apps/api/src/routes/ventas.ts`'s `catalogoProductoDto`) narrowed to what
 * the cart needs to snapshot (D15). */
export interface ProductoParaCarrito {
  productoId: string;
  nombre: string;
  sku: string;
  precio: string;
  stockActual: number;
}

export type CarritoAction =
  | { type: 'AGREGAR'; producto: ProductoParaCarrito; cantidad?: number }
  | { type: 'ACTUALIZAR_CANTIDAD'; productoId: string; cantidad: number }
  | { type: 'QUITAR'; productoId: string }
  | { type: 'VACIAR' }
  | { type: 'CARGAR'; items: CarritoLinea[] };

export function carritoReducer(
  state: CarritoState,
  action: CarritoAction,
): CarritoState {
  switch (action.type) {
    case 'AGREGAR': {
      const { producto } = action;
      const cantidadAAgregar = action.cantidad ?? 1;
      const existente = state.items.find(
        (linea) => linea.productoId === producto.productoId,
      );
      const nuevaCantidad = (existente?.cantidad ?? 0) + cantidadAAgregar;

      if (nuevaCantidad > producto.stockActual) {
        return { ...state, bloqueoStock: producto.productoId };
      }

      // PD-3: a product already in the cart merges into its existing line
      // instead of creating a second one.
      const nuevaLinea: CarritoLinea = {
        productoId: producto.productoId,
        nombre: producto.nombre,
        sku: producto.sku,
        precioSnapshot: producto.precio,
        cantidad: nuevaCantidad,
        stockActual: producto.stockActual,
      };

      const items = existente
        ? state.items.map((linea) =>
            linea.productoId === producto.productoId ? nuevaLinea : linea,
          )
        : [...state.items, nuevaLinea];

      return { items, bloqueoStock: null };
    }

    case 'ACTUALIZAR_CANTIDAD': {
      const linea = state.items.find((l) => l.productoId === action.productoId);
      if (!linea || action.cantidad < 1) {
        return state;
      }

      if (action.cantidad > linea.stockActual) {
        return { ...state, bloqueoStock: action.productoId };
      }

      return {
        items: state.items.map((l) =>
          l.productoId === action.productoId
            ? { ...l, cantidad: action.cantidad }
            : l,
        ),
        bloqueoStock: null,
      };
    }

    case 'QUITAR': {
      return {
        items: state.items.filter(
          (linea) => linea.productoId !== action.productoId,
        ),
        bloqueoStock: null,
      };
    }

    // spec.md L68-81 (PD-9): explicit empty-cart action.
    case 'VACIAR': {
      return initialCarritoState;
    }

    // Used to restore a validated envelope from storage.ts on load.
    case 'CARGAR': {
      return { items: action.items, bloqueoStock: null };
    }

    default: {
      const exhaustiveCheck: never = action;
      return exhaustiveCheck;
    }
  }
}
