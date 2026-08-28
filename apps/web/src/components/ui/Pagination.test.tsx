import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination.js';

describe('Pagination', () => {
  it('calls onPageChange with page+1 when the next control is clicked', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);

    await user.click(screen.getByRole('button', { name: /siguiente/i }));

    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('calls onPageChange with page-1 when the previous control is clicked', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);

    await user.click(screen.getByRole('button', { name: /anterior/i }));

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('calls onPageChange with the clicked page number for a direct page click', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={1} totalPages={3} onPageChange={onPageChange} />);

    await user.click(screen.getByRole('button', { name: '3' }));

    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('disables next/prev/page controls when isBusy is true', () => {
    render(
      <Pagination page={2} totalPages={5} onPageChange={vi.fn()} isBusy />,
    );

    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
  });

  it('renders the current page with the active-page treatment', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={vi.fn()} />);

    const currentPageButton = screen.getByRole('button', { name: '2' });
    expect(currentPageButton).toHaveAttribute('aria-current', 'page');
  });
});
