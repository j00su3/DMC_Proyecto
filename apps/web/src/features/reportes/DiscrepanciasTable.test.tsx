import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  type DiscrepanciaRow,
  DiscrepanciasTable,
} from './DiscrepanciasTable.js';

const resueltaRow: DiscrepanciaRow = {
  id: '1',
  productoId: 'p1',
  productoNombre: 'Azúcar 1kg',
  tipo: 'discrepancia',
  estado: 'resuelta',
  movimientoId: 'm1',
  creadaEn: '2026-09-01T00:00:00.000Z',
  resueltaEn: '2026-09-02T00:00:00.000Z',
  resueltaPor: 'Ana Torres',
};

describe('DiscrepanciasTable', () => {
  it('renders estado, resueltaEn and resueltaPor for a resolved row', () => {
    render(<DiscrepanciasTable discrepancias={[resueltaRow]} />);

    expect(screen.getByText('Azúcar 1kg')).toBeInTheDocument();
    expect(screen.getByText('Resuelta')).toBeInTheDocument();
    expect(screen.getByText('Ana Torres')).toBeInTheDocument();
  });

  it('shows an empty state message when there are no discrepancias', () => {
    render(<DiscrepanciasTable discrepancias={[]} />);

    expect(
      screen.getByText('No hay discrepancias para mostrar.'),
    ).toBeInTheDocument();
  });
});
