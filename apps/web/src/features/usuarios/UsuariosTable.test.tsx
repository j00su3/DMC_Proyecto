import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
