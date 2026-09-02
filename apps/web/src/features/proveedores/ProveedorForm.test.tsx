import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProveedorForm } from './ProveedorForm.js';

const proveedor = {
  nombre: 'Acme Insumos',
  contacto: 'ana@acme.com',
};

/**
 * Presentational boundary (route-module boundary, `LoginForm.tsx:17`'s
 * precedent): `render()` with no router/react-query provider — proves the
 * component takes props/callbacks only.
 */
describe('ProveedorForm', () => {
  it('edit mode: submits only the dirty fields (mirrors D18)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ProveedorForm
        proveedor={proveedor}
        mode="edit"
        onSubmit={onSubmit}
        isPending={false}
      />,
    );

    const nombreField = screen.getByLabelText('Nombre');
    await user.clear(nombreField);
    await user.type(nombreField, 'Acme Insumos SA');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(onSubmit).toHaveBeenCalledWith({ nombre: 'Acme Insumos SA' });
  });

  it('create mode: submits the full pair, mapping an empty contacto to null', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ProveedorForm
        proveedor={{ nombre: '', contacto: '' }}
        mode="create"
        onSubmit={onSubmit}
        isPending={false}
      />,
    );

    await user.type(screen.getByLabelText('Nombre'), 'Nuevo Proveedor');
    await user.click(screen.getByRole('button', { name: 'Crear proveedor' }));

    expect(onSubmit).toHaveBeenCalledWith({
      nombre: 'Nuevo Proveedor',
      contacto: null,
    });
  });

  it('readonly mode: renders a <dl> with zero editable inputs', () => {
    render(
      <ProveedorForm
        proveedor={proveedor}
        mode="edit"
        readonly
        onSubmit={vi.fn()}
        isPending={false}
      />,
    );

    expect(screen.getByText('Acme Insumos')).toBeInTheDocument();
    expect(screen.getByText('ana@acme.com')).toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.querySelector('dl')).toBeInTheDocument();
  });

  it('readonly mode: renders a null/empty contacto as an em dash, never blank', () => {
    render(
      <ProveedorForm
        proveedor={{ nombre: 'Acme Insumos', contacto: '' }}
        mode="edit"
        readonly
        onSubmit={vi.fn()}
        isPending={false}
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
