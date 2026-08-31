import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProductoParaCarrito } from './carrito.js';
import { claveCarrito, guardarCarrito } from './storage.js';
import { useCarrito } from './useCarrito.js';

// design.md's CarritoLinea.productoId schema is `z.string().uuid()`, which
// enforces the RFC 4122 variant nibble (must be one of 8/9/a/b) — a
// same-shaped-but-invalid fixture like `11111111-1111-1111-1111-...` fails
// `carritoStorageEnvelopeSchema.safeParse` silently and the storage layer
// discards it, per storage.ts's D14 "any failure -> empty cart" rule.
const USUARIO_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCTO_ID = '22222222-2222-4222-8222-222222222222';

const PRODUCTO: ProductoParaCarrito = {
  productoId: PRODUCTO_ID,
  nombre: 'Fideos',
  sku: 'FID-001',
  precio: '10.50',
  stockActual: 5,
};

describe('useCarrito', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('starts empty when storage has no envelope for this usuarioId', () => {
    const { result } = renderHook(() => useCarrito(USUARIO_ID));

    expect(result.current.items).toEqual([]);
    expect(result.current.bloqueoStock).toBeNull();
  });

  it('restores a previously saved cart on mount (storage.ts cargarCarrito)', () => {
    guardarCarrito(USUARIO_ID, [
      {
        productoId: PRODUCTO_ID,
        nombre: 'Fideos',
        sku: 'FID-001',
        precioSnapshot: '10.50',
        cantidad: 2,
        stockActual: 5,
      },
    ]);

    const { result } = renderHook(() => useCarrito(USUARIO_ID));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.cantidad).toBe(2);
  });

  it('scopes restore by usuarioId — a different user never sees this cart', () => {
    guardarCarrito(USUARIO_ID, [
      {
        productoId: PRODUCTO_ID,
        nombre: 'Fideos',
        sku: 'FID-001',
        precioSnapshot: '10.50',
        cantidad: 2,
        stockActual: 5,
      },
    ]);

    const otroUsuarioId = '33333333-3333-4333-8333-333333333333';
    const { result } = renderHook(() => useCarrito(otroUsuarioId));

    expect(result.current.items).toEqual([]);
  });

  it('agregar() dispatches AGREGAR and persists the resulting cart to storage', () => {
    const { result } = renderHook(() => useCarrito(USUARIO_ID));

    act(() => {
      result.current.agregar(PRODUCTO);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.cantidad).toBe(1);

    const raw = window.localStorage.getItem(claveCarrito(USUARIO_ID));
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw as string);
    expect(envelope.items).toHaveLength(1);
  });

  it('actualizarCantidad() updates an existing line', () => {
    const { result } = renderHook(() => useCarrito(USUARIO_ID));

    act(() => {
      result.current.agregar(PRODUCTO);
    });
    act(() => {
      result.current.actualizarCantidad(PRODUCTO.productoId, 3);
    });

    expect(result.current.items[0]?.cantidad).toBe(3);
  });

  it('actualizarCantidad() past stockActual sets bloqueoStock instead of throwing', () => {
    const { result } = renderHook(() => useCarrito(USUARIO_ID));

    act(() => {
      result.current.agregar(PRODUCTO);
    });
    act(() => {
      result.current.actualizarCantidad(PRODUCTO.productoId, 99);
    });

    expect(result.current.bloqueoStock).toBe(PRODUCTO.productoId);
    expect(result.current.items[0]?.cantidad).toBe(1);
  });

  it('quitar() removes a line and persists the change', () => {
    const { result } = renderHook(() => useCarrito(USUARIO_ID));

    act(() => {
      result.current.agregar(PRODUCTO);
    });
    act(() => {
      result.current.quitar(PRODUCTO.productoId);
    });

    expect(result.current.items).toEqual([]);
    const raw = window.localStorage.getItem(claveCarrito(USUARIO_ID));
    const envelope = JSON.parse(raw as string);
    expect(envelope.items).toEqual([]);
  });

  it('vaciar() resets to an empty cart (PD-9) and persists the empty state', () => {
    const { result } = renderHook(() => useCarrito(USUARIO_ID));

    act(() => {
      result.current.agregar(PRODUCTO);
    });
    act(() => {
      result.current.vaciar();
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.bloqueoStock).toBeNull();
    const raw = window.localStorage.getItem(claveCarrito(USUARIO_ID));
    const envelope = JSON.parse(raw as string);
    expect(envelope.items).toEqual([]);
  });
});
