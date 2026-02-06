import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SeedInput } from '../SeedInput';

describe('SeedInput', () => {
  it('should render paste mode by default', () => {
    render(<SeedInput value="" onChange={vi.fn()} />);
    expect(
      screen.getByPlaceholderText('Enter your 12-word recovery phrase...')
    ).toBeInTheDocument();
  });

  it('should show word count', () => {
    render(<SeedInput value="abandon abandon abandon" onChange={vi.fn()} />);
    expect(screen.getByText('3 / 12 words')).toBeInTheDocument();
  });

  it('should call onChange on paste input', () => {
    const onChange = vi.fn();
    render(<SeedInput value="" onChange={onChange} />);

    const textarea = screen.getByPlaceholderText(
      'Enter your 12-word recovery phrase...'
    );
    fireEvent.change(textarea, {
      target: { value: 'abandon abandon about' },
    });
    expect(onChange).toHaveBeenCalledWith('abandon abandon about');
  });

  it('should clean non-alpha characters on paste', () => {
    const onChange = vi.fn();
    render(<SeedInput value="" onChange={onChange} />);

    const textarea = screen.getByPlaceholderText(
      'Enter your 12-word recovery phrase...'
    );
    fireEvent.change(textarea, {
      target: { value: 'Abandon 123 About!@#' },
    });
    expect(onChange).toHaveBeenCalledWith('abandon about');
  });

  it('should switch to grid mode', () => {
    render(<SeedInput value="" onChange={vi.fn()} />);

    fireEvent.click(screen.getByText('Word by word'));

    // Should show 12 input fields
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBe(12);
  });

  it('should support 24-word mode', () => {
    render(<SeedInput value="" onChange={vi.fn()} wordCount={24} />);
    expect(screen.getByText('0 / 24 words')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Word by word'));
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBe(24);
  });

  it('should show error message', () => {
    render(
      <SeedInput value="" onChange={vi.fn()} error="Invalid phrase" />
    );
    expect(screen.getByText('Invalid phrase')).toBeInTheDocument();
  });

  it('should handle grid mode word changes', () => {
    const onChange = vi.fn();
    render(<SeedInput value="" onChange={onChange} />);

    fireEvent.click(screen.getByText('Word by word'));

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'abandon' } });
    expect(onChange).toHaveBeenCalled();
  });
});
