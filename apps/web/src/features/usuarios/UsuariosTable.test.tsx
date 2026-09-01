import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UsuariosTable } from './UsuariosTable.js';

const usuarios = [
  {
    id: '1',
    nombre: 'Ana',
    email: 'ana@test.com',
    rol: 'encargado' as const,
    activo: true,
    debeCambiarPassword: false,
    creadoEn: '2026-01-15T12:00:00.000Z',
  },
  {
    id: '2',
    nombre: 'Beto',
    email: 'beto@test.com',
    rol: 'deposito' as const,
    activo: false,
    debeCambiarPassword: false,
    creadoEn: '2025-12-01T12:00:00.000Z',
  },
];

describe('UsuariosTable', () => {
  it('renders one row per user through DataTable, with a StatusChip per row and the date through formatFecha', () => {
    render(<UsuariosTable usuarios={usuarios} />);

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Beto')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByText('15/1/2026')).toBeInTheDocument();
    expect(screen.getByText('1/12/2025')).toBeInTheDocument();
  });

  it('keeps a deactivated user visible in the table, not hidden', () => {
    render(<UsuariosTable usuarios={usuarios} />);

    // Beto is activo=false — the row must still render (usuarios-ui / List
    // Screen With Pagination And Visible Deactivated Users).
    expect(screen.getByText('beto@test.com')).toBeInTheDocument();
  });

  /**
   * D17, extended by the corrected spec (usuarios-ui / Self-Action Block Is
   * A UI Affordance, Not An Authorization Control): the logged-in user's own
   * row renders deactivate/reactivate AND password-reset disabled with a
   * visible adjacent reason. Every other row keeps both enabled — no
   * predicted server refusal, this is purely "aimed at yourself" (D17).
   */
  it('renders deactivate/reactivate and restablecer disabled with a visible reason on the logged-in user own row', () => {
    render(<UsuariosTable usuarios={usuarios} currentUserId="1" />);

    const desactivar = screen.getByRole('button', { name: 'Desactivar' });
    expect(desactivar).toBeDisabled();
    const restablecer = screen.getAllByRole('button', {
      name: 'Restablecer contraseña',
    })[0];
    expect(restablecer).toBeDisabled();
    expect(
      screen.getAllByText(
        /no puede realizar esta acción sobre su propia cuenta/i,
      ).length,
    ).toBeGreaterThan(0);
  });

  it('keeps deactivate/reactivate and restablecer enabled on other users rows', () => {
    render(<UsuariosTable usuarios={usuarios} currentUserId="1" />);

    // Beto (id "2") is not the logged-in user and is inactive → Reactivar.
    const reactivar = screen.getByRole('button', { name: 'Reactivar' });
    expect(reactivar).toBeEnabled();
    const restablecerButtons = screen.getAllByRole('button', {
      name: 'Restablecer contraseña',
    });
    expect(restablecerButtons[1]).toBeEnabled();
  });

  it('calls onView with the row id for every row, including the logged-in user own row', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    render(
      <UsuariosTable usuarios={usuarios} currentUserId="1" onView={onView} />,
    );

    const verButtons = screen.getAllByRole('button', { name: 'Ver' });
    expect(verButtons).toHaveLength(2);

    await user.click(verButtons[0] as HTMLElement);
    expect(onView).toHaveBeenCalledWith('1');

    await user.click(verButtons[1] as HTMLElement);
    expect(onView).toHaveBeenCalledWith('2');
  });

  it('calls onDeactivate/onReactivate/onPasswordReset with the row id when clicked on another user row', async () => {
    const user = userEvent.setup();
    const onDeactivate = vi.fn();
    const onReactivate = vi.fn();
    const onPasswordReset = vi.fn();
    render(
      <UsuariosTable
        usuarios={usuarios}
        currentUserId="1"
        onDeactivate={onDeactivate}
        onReactivate={onReactivate}
        onPasswordReset={onPasswordReset}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Reactivar' }));
    expect(onReactivate).toHaveBeenCalledWith('2');

    await user.click(
      screen.getAllByRole('button', {
        name: 'Restablecer contraseña',
      })[1] as HTMLElement,
    );
    expect(onPasswordReset).toHaveBeenCalledWith('2');
  });
});
