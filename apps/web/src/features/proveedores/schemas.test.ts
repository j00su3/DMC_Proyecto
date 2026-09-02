import { describe, expect, it } from 'vitest';
import {
  EMPTY_PROVEEDOR_FORM,
  proveedorToFormValues,
  toActualizarProveedorInput,
  toCrearProveedorInput,
} from './schemas.js';

describe('toCrearProveedorInput', () => {
  it('maps form values to the wire body', () => {
    expect(
      toCrearProveedorInput({ nombre: 'Acme', contacto: 'ana@acme.com' }),
    ).toEqual({ nombre: 'Acme', contacto: 'ana@acme.com' });
  });

  it('maps an empty contacto to null, never an empty string (D11)', () => {
    expect(toCrearProveedorInput({ nombre: 'Acme', contacto: '' })).toEqual({
      nombre: 'Acme',
      contacto: null,
    });
  });

  it('trims whitespace-only contacto down to null', () => {
    expect(toCrearProveedorInput({ nombre: 'Acme', contacto: '   ' })).toEqual({
      nombre: 'Acme',
      contacto: null,
    });
  });
});

describe('toActualizarProveedorInput', () => {
  it('carries only dirty fields', () => {
    expect(
      toActualizarProveedorInput(
        { nombre: 'Acme 2', contacto: 'ana@acme.com' },
        { nombre: true },
      ),
    ).toEqual({ nombre: 'Acme 2' });
  });

  it('maps a dirty empty contacto to null, never an empty string', () => {
    expect(
      toActualizarProveedorInput(
        { nombre: 'Acme', contacto: '' },
        { contacto: true },
      ),
    ).toEqual({ contacto: null });
  });

  it('returns an empty object when nothing is dirty', () => {
    expect(
      toActualizarProveedorInput({ nombre: 'Acme', contacto: '' }, {}),
    ).toEqual({});
  });
});

describe('proveedorToFormValues', () => {
  it('maps a null contacto to an empty string form value', () => {
    expect(proveedorToFormValues({ nombre: 'Acme', contacto: null })).toEqual({
      nombre: 'Acme',
      contacto: '',
    });
  });

  it('maps a non-null contacto through unchanged', () => {
    expect(
      proveedorToFormValues({ nombre: 'Acme', contacto: 'ana@acme.com' }),
    ).toEqual({ nombre: 'Acme', contacto: 'ana@acme.com' });
  });
});

describe('EMPTY_PROVEEDOR_FORM', () => {
  it('is an all-empty-string form value', () => {
    expect(EMPTY_PROVEEDOR_FORM).toEqual({ nombre: '', contacto: '' });
  });
});
