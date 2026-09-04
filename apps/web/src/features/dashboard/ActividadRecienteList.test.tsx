import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActividadRecienteList } from './ActividadRecienteList.js';

const row = {
  id: 'm1',
  productoId: 'p1',
  productoNombre: 'Harina 000',
  tipo: 'entrada' as const,
  fecha: '2026-09-01T00:00:00.000Z',
  usuarioId: 'u1',
};

describe('ActividadRecienteList', () => {
  it('renders the empty state when no movimientos have ever been recorded', () => {
    render(<ActividadRecienteList movimientos={[]} />);

    expect(
      screen.getByText('No hay movimientos recientes.'),
    ).toBeInTheDocument();
  });

  it('shows producto nombre, tipo, fecha and usuario for each row', () => {
    render(<ActividadRecienteList movimientos={[row]} />);

    expect(screen.getByText('Harina 000')).toBeInTheDocument();
    expect(screen.getByText('Entrada')).toBeInTheDocument();
    expect(screen.getByText('u1')).toBeInTheDocument();
  });

  it('renders both usuarios when movimientos come from two different actors', () => {
    render(
      <ActividadRecienteList
        movimientos={[
          row,
          { ...row, id: 'm2', usuarioId: 'u2', productoNombre: 'Azúcar 1kg' },
        ]}
      />,
    );

    expect(screen.getByText('u1')).toBeInTheDocument();
    expect(screen.getByText('u2')).toBeInTheDocument();
  });
});
