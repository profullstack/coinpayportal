import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SeedDisplay } from '../SeedDisplay';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('SeedDisplay', () => {
  it('should show click-to-reveal initially', () => {
    render(<SeedDisplay mnemonic={TEST_MNEMONIC} />);
    expect(screen.getByText('Click to reveal recovery phrase')).toBeInTheDocument();
    // Words should not be visible
    expect(screen.queryByText('abandon')).not.toBeInTheDocument();
  });

  it('should reveal words after clicking', () => {
    render(<SeedDisplay mnemonic={TEST_MNEMONIC} />);

    fireEvent.click(screen.getByText('Click to reveal recovery phrase'));

    // Now words should be visible
    const abandonElements = screen.getAllByText('abandon');
    expect(abandonElements.length).toBe(11);
    expect(screen.getByText('about')).toBeInTheDocument();
  });

  it('should show numbered word grid', () => {
    render(<SeedDisplay mnemonic={TEST_MNEMONIC} />);
    fireEvent.click(screen.getByText('Click to reveal recovery phrase'));

    // Check numbered labels
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('12.')).toBeInTheDocument();
  });

  it('should show copy button after reveal', () => {
    render(<SeedDisplay mnemonic={TEST_MNEMONIC} />);
    fireEvent.click(screen.getByText('Click to reveal recovery phrase'));

    expect(screen.getByText('Copy to clipboard')).toBeInTheDocument();
  });

  it('should copy mnemonic to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<SeedDisplay mnemonic={TEST_MNEMONIC} />);
    fireEvent.click(screen.getByText('Click to reveal recovery phrase'));
    fireEvent.click(screen.getByText('Copy to clipboard'));

    expect(writeText).toHaveBeenCalledWith(TEST_MNEMONIC);
  });

  it('should show confirm button when onConfirmed is provided', () => {
    const onConfirmed = vi.fn();
    render(<SeedDisplay mnemonic={TEST_MNEMONIC} onConfirmed={onConfirmed} />);
    fireEvent.click(screen.getByText('Click to reveal recovery phrase'));

    const confirmBtn = screen.getByText("I've saved my recovery phrase");
    expect(confirmBtn).toBeInTheDocument();

    fireEvent.click(confirmBtn);
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it('should not show confirm button when onConfirmed is not provided', () => {
    render(<SeedDisplay mnemonic={TEST_MNEMONIC} />);
    fireEvent.click(screen.getByText('Click to reveal recovery phrase'));

    expect(
      screen.queryByText("I've saved my recovery phrase")
    ).not.toBeInTheDocument();
  });

  it('should show the warning about recovery phrase', () => {
    render(<SeedDisplay mnemonic={TEST_MNEMONIC} />);
    expect(screen.getByText('Write down your recovery phrase')).toBeInTheDocument();
  });
});
