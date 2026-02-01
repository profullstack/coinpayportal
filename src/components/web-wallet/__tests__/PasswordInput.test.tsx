import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasswordInput } from '../PasswordInput';

describe('PasswordInput', () => {
  it('should render with label', () => {
    render(
      <PasswordInput value="" onChange={vi.fn()} label="Password" />
    );
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('should render with placeholder', () => {
    render(
      <PasswordInput value="" onChange={vi.fn()} placeholder="Enter pwd" />
    );
    expect(screen.getByPlaceholderText('Enter pwd')).toBeInTheDocument();
  });

  it('should call onChange when typing', () => {
    const onChange = vi.fn();
    render(<PasswordInput value="" onChange={onChange} />);

    const input = screen.getByPlaceholderText('Enter password');
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('should toggle password visibility', () => {
    render(<PasswordInput value="secret" onChange={vi.fn()} />);

    const input = screen.getByPlaceholderText('Enter password');
    expect(input).toHaveAttribute('type', 'password');

    const toggleBtn = screen.getByText('Show');
    fireEvent.click(toggleBtn);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByText('Hide')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Hide'));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('should show strength meter when showStrength is true', () => {
    render(
      <PasswordInput
        value="MyStr0ng!Pass"
        onChange={vi.fn()}
        showStrength
      />
    );
    expect(screen.getByText('Very Strong')).toBeInTheDocument();
  });

  it('should not show strength meter when value is empty', () => {
    render(
      <PasswordInput value="" onChange={vi.fn()} showStrength />
    );
    expect(screen.queryByText('Very Weak')).not.toBeInTheDocument();
  });

  it('should disable input when disabled prop is true', () => {
    render(
      <PasswordInput value="" onChange={vi.fn()} disabled />
    );
    expect(screen.getByPlaceholderText('Enter password')).toBeDisabled();
  });
});
