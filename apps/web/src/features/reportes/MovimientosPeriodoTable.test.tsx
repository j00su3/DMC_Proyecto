import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  type MovimientoRow,
  MovimientosPeriodoTable,
} from './MovimientosPeriodoTable.js';

const row: MovimientoRow = {
  id: '1',
  productoId: 'p1',
  productoNombre: 'Harina 000',
  tipo: 'entrada',
  cantidad: 10,
  motivo: null,
  esDiscrepancia: false,
  esMerma: false,
  usuarioId: 'u1',
  fecha: '2026-09-01T00:00:00.000Z',
  ventaId: null,
  stockResultante: 20,
};

describe('MovimientosPeriodoTable', () => {
  it('renders one row per movimiento with the producto name visible', () => {
    render(
      <MovimientosPeriodoTable
        movimientos={[row]}
        fechaDesde="2026-09-01"
        fechaHasta="2026-09-03"
        onFilterChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Harina 000')).toBeInTheDocument();
  });

  it('shows the empty-range empty state when there are no movimientos', () => {
    render(
      <MovimientosPeriodoTable
        movimientos={[]}
        fechaDesde="2026-09-01"
        fechaHasta="2026-09-03"
        onFilterChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText('No hay movimientos para el período seleccionado.'),
    ).toBeInTheDocument();
  });

  it('calls onFilterChange with the updated range when fechaDesde changes', () => {
    const onFilterChange = vi.fn();
    render(
      <MovimientosPeriodoTable
        movimientos={[row]}
        fechaDesde="2026-09-01"
        fechaHasta="2026-09-03"
        onFilterChange={onFilterChange}
      />,
    );

    const fechaDesdeInput = screen.getByLabelText('Desde');
    fireEvent.change(fechaDesdeInput, { target: { value: '2026-09-02' } });

    expect(onFilterChange).toHaveBeenCalledWith({
      fechaDesde: '2026-09-02',
      fechaHasta: '2026-09-03',
    });
  });

  it('calls onFilterChange with the updated range when fechaHasta changes', () => {
    const onFilterChange = vi.fn();
    render(
      <MovimientosPeriodoTable
        movimientos={[row]}
        fechaDesde="2026-09-01"
        fechaHasta="2026-09-03"
        onFilterChange={onFilterChange}
      />,
    );

    const fechaHastaInput = screen.getByLabelText('Hasta');
    fireEvent.change(fechaHastaInput, { target: { value: '2026-09-04' } });

    expect(onFilterChange).toHaveBeenCalledWith({
      fechaDesde: '2026-09-01',
      fechaHasta: '2026-09-04',
    });
  });
});
