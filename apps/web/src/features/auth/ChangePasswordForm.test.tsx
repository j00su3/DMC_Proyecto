import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChangePasswordForm } from './ChangePasswordForm.js';

/**
 * Presentational boundary (design.md route-module boundary): `render()` with
 * no `RouterProvider` at all — proves `ChangePasswordForm` takes
 * props/callbacks only, same as `LoginForm`.
 */
describe('ChangePasswordForm', () => {
  it('renders zod validation errors and does not call onSubmit for an empty form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ChangePasswordForm onSubmit={onSubmit} />);

    await user.click(
      screen.getByRole('button', { name: 'Guardar contraseña' }),
    );

    expect(
      await screen.findByText('Ingrese su contraseña actual.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'La contraseña nueva debe tener al menos 12 caracteres.',
      ),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with the entered values on a valid submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ChangePasswordForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Contraseña actual'), 'temporal123');
    await user.type(
      screen.getByLabelText('Contraseña nueva'),
      'unaContraseñaSegura',
    );
    await user.click(
      screen.getByRole('button', { name: 'Guardar contraseña' }),
    );

    expect(onSubmit).toHaveBeenCalledWith({
      currentPassword: 'temporal123',
      newPassword: 'unaContraseñaSegura',
    });
  });

  it('binds a server INVALID_CURRENT_PASSWORD error to the currentPassword field, not a banner (D5)', () => {
    render(
      <ChangePasswordForm
        onSubmit={vi.fn()}
        currentPasswordError="La contraseña actual es incorrecta."
      />,
    );

    expect(
      screen.getByText('La contraseña actual es incorrecta.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the submit button while pending', () => {
    render(<ChangePasswordForm onSubmit={vi.fn()} isPending />);

    expect(
      screen.getByRole('button', { name: 'Guardar contraseña' }),
    ).toBeDisabled();
  });
});
