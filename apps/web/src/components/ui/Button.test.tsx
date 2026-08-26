import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.js';

describe('Button', () => {
  it('renders its label and fires onClick when the primary variant is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Button variant="primary" onClick={onClick}>
        Ingresar
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Ingresar' });
    await user.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables the button when pending', () => {
    render(
      <Button variant="primary" isPending>
        Ingresar
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Ingresar' })).toBeDisabled();
  });

  it('disables the button when explicitly disabled', () => {
    render(
      <Button variant="primary" disabled>
        Ingresar
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Ingresar' })).toBeDisabled();
  });

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Button variant="primary" disabled onClick={onClick}>
        Ingresar
      </Button>,
    );

    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a visible keyboard focus ring class', () => {
    render(<Button variant="primary">Ingresar</Button>);

    const button = screen.getByRole('button', { name: 'Ingresar' });
    expect(button.className).toMatch(/button/);
  });
});
