/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CountrySelect } from './CountrySelect';

function Harness({ initial = '', required = false, onChange }: { initial?: string; required?: boolean; onChange?: (c: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form>
      <CountrySelect
        id="c"
        required={required}
        value={value}
        onChange={(c) => {
          setValue(c);
          onChange?.(c);
        }}
      />
      <output data-testid="value">{value}</output>
      <button type="button">elsewhere</button>
    </form>
  );
}

describe('CountrySelect', () => {
  it('typing "Nigeria" sets NG without picking from the list', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('combobox'), 'Nigeria');
    expect(screen.getByTestId('value').textContent).toBe('NG');
    await userEvent.click(screen.getByText('elsewhere'));
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Nigeria (NG)');
  });

  it('typing a code or alpha-3 resolves too', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('combobox'), 'nga');
    expect(screen.getByTestId('value').textContent).toBe('NG');
  });

  it('partial text + Enter picks the highlighted best match', async () => {
    render(<Harness />);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'nige');
    expect(screen.getByTestId('value').textContent).toBe('');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('NG'); // Niger, Nigeria
  });

  it('clicking an option selects it', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('combobox'), 'ghan');
    await userEvent.click(screen.getByRole('option', { name: /Ghana/ }));
    expect(screen.getByTestId('value').textContent).toBe('GH');
  });

  it('unknown text is invalid so a required form will not submit', async () => {
    render(<Harness required />);
    const box = screen.getByRole('combobox') as HTMLInputElement;
    await userEvent.type(box, 'Atlantis');
    await userEvent.click(screen.getByText('elsewhere'));
    expect(screen.getByTestId('value').textContent).toBe('');
    expect(box.validity.valid).toBe(false);
  });

  it('shows the label for an initial value', () => {
    render(<Harness initial="US" />);
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('United States of America (US)');
  });

  it('respects a restricted list', async () => {
    const onChange = vi.fn();
    render(<CountrySelect value="" onChange={onChange} countries={[{ code: 'US', name: 'United States' }]} />);
    await userEvent.type(screen.getByRole('combobox'), 'Nigeria');
    expect(onChange).not.toHaveBeenCalledWith('NG');
    expect(screen.getByText('No matching country')).toBeTruthy();
  });
});
