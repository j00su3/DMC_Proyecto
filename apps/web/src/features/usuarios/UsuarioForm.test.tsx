import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UsuarioForm } from './UsuarioForm.js';

const usuario = {
  nombre: 'Ana',
  email: 'ana@test.com',
  rol: 'encargado' as const,
};

/**
 * Presentational boundary (route-module boundary, `LoginForm.tsx:17`'s
 * precedent): `render()` with no router/react-query provider — proves the
 * component takes props/callbacks only.
 *
 * D17 (extended by the corrected spec to cover `rol`): on the logged-in
 * user's own account `rol` renders disabled with a visible reason while
 * `nombre`/`email` stay editable. The wording must not claim server
 * authority — the server still permits self-demotion; the screen simply
 * declines to offer it.
 */
describe('UsuarioForm', () => {
  it('renders rol disabled with a visible reason on the logged-in user own account (D17)', () => {
    render(
      <UsuarioForm
        usuario={usuario}
        isOwnAccount
        onSubmit={vi.fn()}
        isPending={false}
      />,
    );

    const rolField = screen.getByLabelText('Rol');
    expect(rolField).toBeDisabled();
    expect(
      screen.getByText(
        /el sistema no permite cambiar su propio rol desde aquí/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toBeEnabled();
    expect(screen.getByLabelText('Correo')).toBeEnabled();
  });

  it('renders rol enabled with no reason on another user account', () => {
    render(
      <UsuarioForm
        usuario={usuario}
        isOwnAccount={false}
        onSubmit={vi.fn()}
        isPending={false}
      />,
    );

    expect(screen.getByLabelText('Rol')).toBeEnabled();
    expect(
      screen.queryByText(
        /el sistema no permite cambiar su propio rol desde aquí/i,
      ),
    ).not.toBeInTheDocument();
  });

  it('submits only the dirty fields (D18): changing only nombre yields {nombre}', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <UsuarioForm
        usuario={usuario}
        isOwnAccount={false}
        onSubmit={onSubmit}
        isPending={false}
      />,
    );

    const nombreField = screen.getByLabelText('Nombre');
    await user.clear(nombreField);
    await user.type(nombreField, 'Nuevo nombre');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(onSubmit).toHaveBeenCalledWith({ nombre: 'Nuevo nombre' });
  });

  it('disables the submit button while nothing is dirty', () => {
    render(
      <UsuarioForm
        usuario={usuario}
        isOwnAccount={false}
        onSubmit={vi.fn()}
        isPending={false}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Guardar cambios' }),
    ).toBeDisabled();
  });
});
