import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiCard } from './KpiCard.js';

describe('KpiCard', () => {
  it('renders the label and value', () => {
    render(<KpiCard label="Quiebres" value={2} />);

    expect(screen.getByText('Quiebres')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('applies the danger variant class for a critical KPI', () => {
    const { container } = render(
      <KpiCard label="Quiebres" value={5} variant="danger" />,
    );

    expect(container.firstElementChild?.className).toMatch(/danger/);
  });

  it('does not apply the danger variant class by default', () => {
    const { container } = render(<KpiCard label="Quiebres" value={0} />);

    expect(container.firstElementChild?.className).not.toMatch(/danger/);
  });
});
