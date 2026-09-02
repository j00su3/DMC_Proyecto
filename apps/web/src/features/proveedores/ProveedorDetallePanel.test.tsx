import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProveedorDetallePanel } from './ProveedorDetallePanel.js';

const proveedorActivo = {
  nombre: 'Acme Insumos',
  contacto: 'ana@acme.com',
  activo: true,
};

const proveedorInactivo = {
  nombre: 'Beta Distribuciones',
  contacto: '',
  activo: false,
};

/**
 * Presentational boundary (route-module boundary, `LoginForm.tsx:17`'s
 * precedent): `render()` with no router/react-query provider — proves the
 * component takes props/callbacks only. `isDeposito` gating mirrors
 * `productosDetalle.tsx:53,57,148-168` (D5): a UI affordance only, the
 * server's role check remains the real boundary.
 */
describe('ProveedorDetallePanel', () => {
  it('encargado + active proveedor: renders a single Desactivar button with no modal', async () => {
    const user = userEvent.setup();
    const onDeactivate = vi.fn();

    render(
      <ProveedorDetallePanel
        actorRol="encargado"
        proveedor={proveedorActivo}
        onDeactivate={onDeactivate}
      />,
    );

    const buttons = screen.getAllByRole('button', {
      name: /desactivar|reactivar/i,
    });
    expect(buttons).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Desactivar' }));
    expect(onDeactivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('encargado + inactive proveedor: renders a single Reactivar button', async () => {
    const user = userEvent.setup();
    const onReactivate = vi.fn();

    render(
      <ProveedorDetallePanel
        actorRol="encargado"
        proveedor={proveedorInactivo}
        onReactivate={onReactivate}
      />,
    );

    const buttons = screen.getAllByRole('button', {
      name: /desactivar|reactivar/i,
    });
    expect(buttons).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Reactivar' }));
    expect(onReactivate).toHaveBeenCalledTimes(1);
  });

  it('deposito: the estado button is disabled with a visible 🔒-prefixed reason', () => {
    render(
      <ProveedorDetallePanel actorRol="deposito" proveedor={proveedorActivo} />,
    );

    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeDisabled();
    expect(screen.getByText(/🔒/)).toBeInTheDocument();
    expect(screen.getByText(/solo un encargado puede/i)).toBeInTheDocument();
  });

  it('deposito: the detail fields render read-only (zero editable inputs)', () => {
    render(
      <ProveedorDetallePanel actorRol="deposito" proveedor={proveedorActivo} />,
    );

    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getByText('ana@acme.com')).toBeInTheDocument();
  });

  it('placeholder (nothing selected): encargado sees a Crear proveedor nuevo trigger', async () => {
    const user = userEvent.setup();
    const onStartCreate = vi.fn();

    render(
      <ProveedorDetallePanel
        actorRol="encargado"
        proveedor={null}
        onStartCreate={onStartCreate}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Crear proveedor nuevo' }),
    );
    expect(onStartCreate).toHaveBeenCalledTimes(1);
  });

  it('placeholder (nothing selected): deposito does not see the create action (PD-5)', () => {
    render(<ProveedorDetallePanel actorRol="deposito" proveedor={null} />);

    expect(
      screen.queryByRole('button', { name: 'Crear proveedor nuevo' }),
    ).not.toBeInTheDocument();
  });

  it('isCreating: renders the create form and submits through onCreate', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    render(
      <ProveedorDetallePanel
        actorRol="encargado"
        proveedor={null}
        isCreating
        onCreate={onCreate}
      />,
    );

    await user.type(screen.getByLabelText('Nombre'), 'Nuevo Proveedor');
    await user.click(screen.getByRole('button', { name: 'Crear proveedor' }));

    expect(onCreate).toHaveBeenCalledWith({
      nombre: 'Nuevo Proveedor',
      contacto: null,
    });
  });
});
