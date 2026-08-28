import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CredentialDialog } from './CredentialDialog.js';

/**
 * P4 (design.md Testing Strategy) — D14: the password renders in a
 * monospace block grouped 4×4 with `user-select: all`, the copy states it
 * cannot be shown again, and no copy-to-clipboard button exists anywhere in
 * the component. A "Copiar" button writes to the OS clipboard, which other
 * apps and cloud-sync services read — deliberately not built.
 */
describe('CredentialDialog', () => {
  it('renders the password in a monospace block grouped 4×4', () => {
    render(
      <CredentialDialog
        credential={{ nombre: 'Ana', passwordTemporal: 'XK7T9QM4BN2CVR8H' }}
        onAcknowledge={vi.fn()}
      />,
    );

    expect(screen.getByText('XK7T-9QM4-BN2C-VR8H')).toBeInTheDocument();
  });

  it('states the password cannot be shown again', () => {
    render(
      <CredentialDialog
        credential={{ nombre: 'Ana', passwordTemporal: 'XK7T9QM4BN2CVR8H' }}
        onAcknowledge={vi.fn()}
      />,
    );

    expect(screen.getByText(/no podrá volver a verla/i)).toBeInTheDocument();
  });

  it('never renders a copy-to-clipboard button', () => {
    render(
      <CredentialDialog
        credential={{ nombre: 'Ana', passwordTemporal: 'XK7T9QM4BN2CVR8H' }}
        onAcknowledge={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /copiar/i }),
    ).not.toBeInTheDocument();
  });

  it('calls onAcknowledge from the acknowledge button', async () => {
    const onAcknowledge = vi.fn();
    render(
      <CredentialDialog
        credential={{ nombre: 'Ana', passwordTemporal: 'XK7T9QM4BN2CVR8H' }}
        onAcknowledge={onAcknowledge}
      />,
    );

    screen.getByRole('button', { name: 'Entendido' }).click();

    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });
});
