import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProveedoresTable } from './ProveedoresTable.js';

const proveedores = [
  {
    id: '1',
    nombre: 'Acme Insumos',
    contacto: 'ana@acme.com',
    activo: true,
    creadoEn: '2026-01-15T12:00:00.000Z',
  },
  {
    id: '2',
    nombre: 'Beta Distribuciones',
    contacto: null,
    activo: false,
    creadoEn: '2025-12-01T12:00:00.000Z',
  },
];

describe('ProveedoresTable', () => {
  it('renders one row per proveedor through DataTable, with a StatusChip per row', () => {
    render(<ProveedoresTable proveedores={proveedores} />);

    expect(screen.getByText('Acme Insumos')).toBeInTheDocument();
    expect(screen.getByText('Beta Distribuciones')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
  });

  it('keeps a deactivated proveedor visible in the table, not hidden', () => {
    render(<ProveedoresTable proveedores={proveedores} />);

    expect(screen.getByText('Beta Distribuciones')).toBeInTheDocument();
  });

  it('renders a null contacto as an em dash, never as the literal null', () => {
    render(<ProveedoresTable proveedores={proveedores} />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('calls onSelect with the row id when a row is chosen', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProveedoresTable proveedores={proveedores} onSelect={onSelect} />);

    const verButtons = screen.getAllByRole('button', { name: 'Ver' });
    expect(verButtons).toHaveLength(2);

    await user.click(verButtons[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('1');

    await user.click(verButtons[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('2');
  });

  it('filters rows by a nombre substring, case-insensitively, with no server request', async () => {
    const user = userEvent.setup();
    render(<ProveedoresTable proveedores={proveedores} />);

    await user.type(
      screen.getByLabelText('Buscar por nombre o contacto'),
      'ACME',
    );

    expect(screen.getByText('Acme Insumos')).toBeInTheDocument();
    expect(screen.queryByText('Beta Distribuciones')).not.toBeInTheDocument();
  });

  it('filters rows by a contacto substring, null-safe (does not throw on a null contacto)', async () => {
    const user = userEvent.setup();
    render(<ProveedoresTable proveedores={proveedores} />);

    await user.type(
      screen.getByLabelText('Buscar por nombre o contacto'),
      'ana@acme.com',
    );

    expect(screen.getByText('Acme Insumos')).toBeInTheDocument();
    expect(screen.queryByText('Beta Distribuciones')).not.toBeInTheDocument();
  });

  it('shows an empty-result state when the filter matches nothing', async () => {
    const user = userEvent.setup();
    render(<ProveedoresTable proveedores={proveedores} />);

    await user.type(
      screen.getByLabelText('Buscar por nombre o contacto'),
      'nadie-coincide',
    );

    expect(screen.queryByText('Acme Insumos')).not.toBeInTheDocument();
    expect(screen.queryByText('Beta Distribuciones')).not.toBeInTheDocument();
    expect(
      screen.getByText(/no se encontraron proveedores/i),
    ).toBeInTheDocument();
  });
});
