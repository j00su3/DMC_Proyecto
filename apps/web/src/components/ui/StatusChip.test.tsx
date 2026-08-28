import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusChip } from './StatusChip.js';

describe('StatusChip', () => {
  it('renders "Inactivo" for activo=false', () => {
    render(<StatusChip activo={false} />);
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
  });

  it('renders "Activo" for activo=true', () => {
    render(<StatusChip activo={true} />);
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('renders the warning "Debe cambiar contraseña" variant when debeCambiarPassword is true', () => {
    render(<StatusChip activo={true} debeCambiarPassword />);
    expect(screen.getByText('Debe cambiar contraseña')).toBeInTheDocument();
  });
});
