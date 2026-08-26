import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormError } from './FormError.js';

describe('FormError', () => {
  it('renders the message with role="alert"', () => {
    render(<FormError message="El correo o la contraseña son incorrectos." />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'El correo o la contraseña son incorrectos.',
    );
  });
});
