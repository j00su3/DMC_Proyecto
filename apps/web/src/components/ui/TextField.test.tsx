import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField.js';

describe('TextField', () => {
  it('binds the label to the input via htmlFor/id', () => {
    render(<TextField id="email" label="Correo electrónico" />);

    const input = screen.getByLabelText('Correo electrónico');
    expect(input).toHaveAttribute('id', 'email');
  });

  it('does not set aria-invalid or aria-describedby when there is no error', () => {
    render(<TextField id="email" label="Correo electrónico" />);

    const input = screen.getByLabelText('Correo electrónico');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('wires aria-invalid and aria-describedby when an error prop is present', () => {
    render(
      <TextField
        id="email"
        label="Correo electrónico"
        error="El correo es obligatorio"
      />,
    );

    const input = screen.getByLabelText('Correo electrónico');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const errorMessage = document.getElementById(describedBy as string);
    expect(errorMessage).toHaveTextContent('El correo es obligatorio');
  });
});
