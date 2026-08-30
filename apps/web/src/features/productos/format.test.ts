import { describe, expect, it } from 'vitest';
import { estadoStock } from './format.js';

describe('estadoStock', () => {
  it('returns quiebre when stockActual <= 0, regardless of stockMinimo', () => {
    expect(estadoStock(0, 10)).toBe('quiebre');
    expect(estadoStock(-1, null)).toBe('quiebre');
  });

  it('returns bajo when stockMinimo is set and stockActual <= stockMinimo', () => {
    expect(estadoStock(8, 10)).toBe('bajo');
    expect(estadoStock(10, 10)).toBe('bajo');
  });

  it('returns ok, never bajo, when stockMinimo is null — no false alarm (D9)', () => {
    expect(estadoStock(5, null)).toBe('ok');
    expect(estadoStock(1000, null)).toBe('ok');
  });

  it('returns ok when stockActual is above a set stockMinimo', () => {
    expect(estadoStock(12, 10)).toBe('ok');
  });
});
