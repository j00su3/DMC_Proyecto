import { describe, expect, it } from 'vitest';
import {
  type CarritoAction,
  type CarritoState,
  carritoReducer,
  initialCarritoState,
} from './carrito.js';

const productoX = {
  productoId: '11111111-1111-1111-1111-111111111111',
  nombre: 'Producto X',
  sku: 'SKU-X',
  precio: '10.00',
  stockActual: 5,
};

const productoY = {
  productoId: '22222222-2222-2222-2222-222222222222',
  nombre: 'Producto Y',
  sku: 'SKU-Y',
  precio: '20.00',
  stockActual: 1,
};

function agregar(
  state: CarritoState,
  producto: typeof productoX,
  cantidad = 1,
): CarritoState {
  const accion: CarritoAction = { type: 'AGREGAR', producto, cantidad };
  return carritoReducer(state, accion);
}

describe('carritoReducer', () => {
  it('starts empty', () => {
    expect(initialCarritoState).toEqual({ items: [], bloqueoStock: null });
  });

  // spec.md L31-38 (PD-3): adding a product already in the cart merges into
  // its existing line rather than creating a second one.
  it('merges a duplicate productoId into the existing line instead of adding a second one', () => {
    let state = initialCarritoState;
    state = agregar(state, productoX, 2);
    state = agregar(state, productoX, 1);

    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.cantidad).toBe(3);
  });

  it('adds a new line for a different productoId', () => {
    let state = initialCarritoState;
    state = agregar(state, productoX, 1);
    state = agregar(state, productoY, 1);

    expect(state.items).toHaveLength(2);
    expect(state.items.map((i) => i.productoId)).toEqual([
      productoX.productoId,
      productoY.productoId,
    ]);
  });

  it('carries the price snapshot and stock snapshot onto the line (D15/D-13)', () => {
    const state = agregar(initialCarritoState, productoX, 1);

    expect(state.items[0]).toMatchObject({
      productoId: productoX.productoId,
      nombre: productoX.nombre,
      sku: productoX.sku,
      precioSnapshot: productoX.precio,
      stockActual: productoX.stockActual,
      cantidad: 1,
    });
  });

  // design.md D-13 (PD-13): block add/edit beyond the catalog's
  // stockActual, surfaced as a UX-only "no stock available" state — the
  // server confirmation stays the sole authority.
  it('blocks adding past stockActual and does not change the cart', () => {
    const state = agregar(initialCarritoState, productoY, 2);

    expect(state.items).toHaveLength(0);
    expect(state.bloqueoStock).toBe(productoY.productoId);
  });

  it('blocks merging past stockActual on a second add', () => {
    let state = agregar(initialCarritoState, productoX, 5);
    state = agregar(state, productoX, 1);

    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.cantidad).toBe(5);
    expect(state.bloqueoStock).toBe(productoX.productoId);
  });

  it('clears a previous bloqueoStock once a valid action is dispatched', () => {
    let state = agregar(initialCarritoState, productoY, 2); // blocked
    expect(state.bloqueoStock).toBe(productoY.productoId);

    state = agregar(state, productoX, 1); // valid
    expect(state.bloqueoStock).toBeNull();
  });

  it('ACTUALIZAR_CANTIDAD edits an existing line quantity', () => {
    let state = agregar(initialCarritoState, productoX, 1);
    state = carritoReducer(state, {
      type: 'ACTUALIZAR_CANTIDAD',
      productoId: productoX.productoId,
      cantidad: 3,
    });

    expect(state.items[0]?.cantidad).toBe(3);
  });

  it('ACTUALIZAR_CANTIDAD blocks an edit past stockActual and leaves quantity unchanged', () => {
    let state = agregar(initialCarritoState, productoY, 1);
    state = carritoReducer(state, {
      type: 'ACTUALIZAR_CANTIDAD',
      productoId: productoY.productoId,
      cantidad: 2,
    });

    expect(state.items[0]?.cantidad).toBe(1);
    expect(state.bloqueoStock).toBe(productoY.productoId);
  });

  it('ACTUALIZAR_CANTIDAD is a no-op for a productoId not in the cart', () => {
    const state = carritoReducer(initialCarritoState, {
      type: 'ACTUALIZAR_CANTIDAD',
      productoId: productoX.productoId,
      cantidad: 2,
    });

    expect(state).toEqual(initialCarritoState);
  });

  it('QUITAR removes a single line and leaves the rest untouched', () => {
    let state = agregar(initialCarritoState, productoX, 1);
    state = agregar(state, productoY, 1);
    state = carritoReducer(state, {
      type: 'QUITAR',
      productoId: productoX.productoId,
    });

    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.productoId).toBe(productoY.productoId);
  });

  // spec.md L68-81 (PD-9): explicit empty-cart action clears the cart
  // without a sale being confirmed.
  it('VACIAR clears every line explicitly', () => {
    let state = agregar(initialCarritoState, productoX, 1);
    state = agregar(state, productoY, 1);
    state = carritoReducer(state, { type: 'VACIAR' });

    expect(state).toEqual(initialCarritoState);
  });

  it('CARGAR replaces the cart wholesale (used by storage restore)', () => {
    const items = [
      {
        productoId: productoX.productoId,
        nombre: productoX.nombre,
        sku: productoX.sku,
        precioSnapshot: productoX.precio,
        cantidad: 2,
        stockActual: productoX.stockActual,
      },
    ];
    const state = carritoReducer(initialCarritoState, {
      type: 'CARGAR',
      items,
    });

    expect(state.items).toEqual(items);
    expect(state.bloqueoStock).toBeNull();
  });
});
