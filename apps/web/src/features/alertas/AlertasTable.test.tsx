import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type AlertaRow, AlertasTable } from './AlertasTable.js';

const stockBajoRow: AlertaRow = {
  id: '1',
  productoId: 'p1',
  productoNombre: 'Harina 000',
  tipo: 'stock_bajo',
  estado: 'activa',
  movimientoId: 'm1',
  creadaEn: '2026-09-01T00:00:00.000Z',
  resueltaEn: null,
  resueltaPor: null,
};

const discrepanciaRow: AlertaRow = {
  id: '2',
  productoId: 'p2',
  productoNombre: 'Azúcar 1kg',
  tipo: 'discrepancia',
  estado: 'activa',
  movimientoId: 'm2',
  creadaEn: '2026-09-01T00:00:00.000Z',
  resueltaEn: null,
  resueltaPor: null,
};

describe('AlertasTable', () => {
  it('renders one row per alert with producto name visible', () => {
    render(
      <AlertasTable
        alertas={[stockBajoRow, discrepanciaRow]}
        actorRol="encargado"
        onResolve={vi.fn()}
      />,
    );

    expect(screen.getByText('Harina 000')).toBeInTheDocument();
    expect(screen.getByText('Azúcar 1kg')).toBeInTheDocument();
  });

  it('offers a resolve control for an activa discrepancia row when actorRol is encargado', () => {
    render(
      <AlertasTable
        alertas={[discrepanciaRow]}
        actorRol="encargado"
        onResolve={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Resolver' }),
    ).toBeInTheDocument();
  });

  it('does not offer a resolve control for a deposito session (server 403 boundary, UX affordance only)', () => {
    render(
      <AlertasTable
        alertas={[discrepanciaRow]}
        actorRol="deposito"
        onResolve={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Resolver' }),
    ).not.toBeInTheDocument();
  });

  it('does not offer a resolve control for a stock_bajo row even for encargado (server refuses it)', () => {
    render(
      <AlertasTable
        alertas={[stockBajoRow]}
        actorRol="encargado"
        onResolve={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Resolver' }),
    ).not.toBeInTheDocument();
  });

  it('calls onResolve with the alert id when the resolve control is activated', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <AlertasTable
        alertas={[discrepanciaRow]}
        actorRol="encargado"
        onResolve={onResolve}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Resolver' }));

    expect(onResolve).toHaveBeenCalledWith('2');
  });
});
