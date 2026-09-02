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

  /**
   * The master pane is only 340px wide (docs/design.md:93). A fourth
   * "Contacto" column made the table wider than that track, and
   * DataTable.module.css's `.card { overflow: hidden }` silently clipped
   * Estado/Acciones off the visible edge instead of showing them. Contacto
   * stays fully visible in the detail pane (`ProveedorDetallePanel`) and
   * remains searchable via the filter above — it just isn't its own column
   * here anymore.
   */
  it('does not render a Contacto column — the master pane is too narrow for it (fixes silent column clipping)', () => {
    render(<ProveedoresTable proveedores={proveedores} />);

    expect(
      screen.queryByRole('columnheader', { name: 'Contacto' }),
    ).not.toBeInTheDocument();
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

  /**
   * PD-5, master-pane placement fix: the spec says literally "The master
   * pane MUST offer a Crear proveedor nuevo action" — verify-report.md
   * flagged the previous placement (inside ProveedorDetallePanel's
   * nothing-selected placeholder) as a WARNING because it made the trigger
   * unreachable once any row was selected. It lives here now, so it renders
   * regardless of what the detail pane shows.
   */
  it('encargado: shows a Crear proveedor nuevo trigger that calls onStartCreate', async () => {
    const user = userEvent.setup();
    const onStartCreate = vi.fn();
    render(
      <ProveedoresTable
        proveedores={proveedores}
        actorRol="encargado"
        onStartCreate={onStartCreate}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Crear proveedor nuevo' }),
    );
    expect(onStartCreate).toHaveBeenCalledTimes(1);
  });

  it('deposito: does not see the create trigger (PD-5)', () => {
    render(<ProveedoresTable proveedores={proveedores} actorRol="deposito" />);

    expect(
      screen.queryByRole('button', { name: 'Crear proveedor nuevo' }),
    ).not.toBeInTheDocument();
  });

  it('no actorRol given: hides the create trigger by default (safe default)', () => {
    render(<ProveedoresTable proveedores={proveedores} />);

    expect(
      screen.queryByRole('button', { name: 'Crear proveedor nuevo' }),
    ).not.toBeInTheDocument();
  });
});
