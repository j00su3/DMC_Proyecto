import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from './LoginForm.js';

/**
 * Presentational boundary (design.md route-module boundary): `render()` with
 * no `RouterProvider` at all — proves `LoginForm` takes props/callbacks only.
 */
describe('LoginForm', () => {
  it('renders zod validation errors and does not call onSubmit for an empty form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<LoginForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(
      await screen.findByText('Ingrese un correo electrónico válido.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Ingrese su contraseña.'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with trimmed email/password on a valid submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<LoginForm onSubmit={onSubmit} />);

    await user.type(
      screen.getByLabelText('Correo electrónico'),
      '  encargado@tienda.com  ',
    );
    await user.type(screen.getByLabelText('Contraseña'), 'secreto123');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: 'encargado@tienda.com',
      password: 'secreto123',
    });
  });

  it('renders a server error message', () => {
    render(
      <LoginForm
        onSubmit={vi.fn()}
        errorMessage="El correo o la contraseña son incorrectos. Verifique los datos e intente de nuevo."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'El correo o la contraseña son incorrectos. Verifique los datos e intente de nuevo.',
    );
  });

  it('disables the submit button while pending', () => {
    render(<LoginForm onSubmit={vi.fn()} isPending />);

    expect(screen.getByRole('button', { name: 'Ingresar' })).toBeDisabled();
  });
});
