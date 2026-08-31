import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CART_TTL_MS,
  cargarCarrito,
  claveCarrito,
  guardarCarrito,
} from './storage.js';

const usuarioId = '33333333-3333-3333-3333-333333333333';

const linea = {
  productoId: '11111111-1111-4111-8111-111111111111',
  nombre: 'Producto X',
  sku: 'SKU-X',
  precioSnapshot: '10.00',
  cantidad: 2,
  stockActual: 5,
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('claveCarrito', () => {
  it('is versioned and scoped per usuarioId (D14)', () => {
    expect(claveCarrito(usuarioId)).toBe(
      `inventienda.pos.carrito.v1.${usuarioId}`,
    );
  });
});

describe('cargarCarrito', () => {
  it('returns an empty cart when nothing is stored', () => {
    expect(cargarCarrito(usuarioId)).toEqual([]);
  });

  it('round-trips a cart written by guardarCarrito', () => {
    guardarCarrito(usuarioId, [linea]);

    expect(cargarCarrito(usuarioId)).toEqual([linea]);
  });

  it('is scoped per usuarioId — a different user does not see this cart', () => {
    guardarCarrito(usuarioId, [linea]);

    expect(cargarCarrito('otro-usuario')).toEqual([]);
  });

  // spec.md L58-66 / design.md D14: unparseable JSON falls back to an empty
  // cart, and the corrupt key is discarded rather than left behind.
  it('discards corrupt JSON and starts empty, without throwing', () => {
    window.localStorage.setItem(claveCarrito(usuarioId), '{not-json');

    expect(() => cargarCarrito(usuarioId)).not.toThrow();
    expect(cargarCarrito(usuarioId)).toEqual([]);
    expect(window.localStorage.getItem(claveCarrito(usuarioId))).toBeNull();
  });

  it('discards a value that does not match the envelope schema and starts empty', () => {
    window.localStorage.setItem(
      claveCarrito(usuarioId),
      JSON.stringify({ items: [linea] }), // missing v/savedAt
    );

    expect(cargarCarrito(usuarioId)).toEqual([]);
    expect(window.localStorage.getItem(claveCarrito(usuarioId))).toBeNull();
  });

  it('discards an envelope with the wrong version and starts empty', () => {
    window.localStorage.setItem(
      claveCarrito(usuarioId),
      JSON.stringify({ v: 2, items: [linea], savedAt: Date.now() }),
    );

    expect(cargarCarrito(usuarioId)).toEqual([]);
    expect(window.localStorage.getItem(claveCarrito(usuarioId))).toBeNull();
  });

  it('discards an envelope with a malformed line and starts empty', () => {
    window.localStorage.setItem(
      claveCarrito(usuarioId),
      JSON.stringify({
        v: 1,
        items: [{ productoId: 'not-a-uuid' }],
        savedAt: Date.now(),
      }),
    );

    expect(cargarCarrito(usuarioId)).toEqual([]);
    expect(window.localStorage.getItem(claveCarrito(usuarioId))).toBeNull();
  });

  // design.md D14 (amended by PD-14): a cart older than CART_TTL_MS (4h) is
  // discarded on load, same code path as a corrupt/incompatible value.
  it('discards a cart older than CART_TTL_MS and starts empty', () => {
    const savedAt = Date.now() - (CART_TTL_MS + 1);
    window.localStorage.setItem(
      claveCarrito(usuarioId),
      JSON.stringify({ v: 1, items: [linea], savedAt }),
    );

    expect(cargarCarrito(usuarioId)).toEqual([]);
    expect(window.localStorage.getItem(claveCarrito(usuarioId))).toBeNull();
  });

  it('keeps a cart saved exactly at the TTL boundary', () => {
    const savedAt = Date.now() - (CART_TTL_MS - 1000);
    window.localStorage.setItem(
      claveCarrito(usuarioId),
      JSON.stringify({ v: 1, items: [linea], savedAt }),
    );

    expect(cargarCarrito(usuarioId)).toEqual([linea]);
  });

  it('does not throw when localStorage.getItem itself throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(() => cargarCarrito(usuarioId)).not.toThrow();
    expect(cargarCarrito(usuarioId)).toEqual([]);
  });
});

describe('guardarCarrito', () => {
  it('rewrites savedAt to the current time on every save', () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(t0);
    guardarCarrito(usuarioId, [linea]);

    const raw = window.localStorage.getItem(claveCarrito(usuarioId));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).savedAt).toBe(t0);
  });

  // design.md D14: a write that fails (quota, storage unavailable) degrades
  // to in-memory only — it must never throw out of guardarCarrito.
  it('degrades to memory without throwing when setItem fails (quota)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => guardarCarrito(usuarioId, [linea])).not.toThrow();
  });
});
