// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { dialogConfirm, dialogPrompt, dialogAlert } from '../dialog.js';

const modal = () => document.querySelector('dialog.modal') as HTMLDialogElement | null;
const buttonLabelled = (text: string) =>
  [...document.querySelectorAll('dialog.modal button')].find((b) => b.textContent === text) as HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('dialogConfirm', () => {
  it('renders a <dialog> rather than calling window.confirm', async () => {
    const pending = dialogConfirm({ title: 'Confirm payment', confirmLabel: 'Send' });
    expect(modal()).not.toBeNull();
    expect(modal()!.textContent).toContain('Confirm payment');

    buttonLabelled('Send').click();
    await expect(pending).resolves.toBe(true);
  });

  it('resolves false on cancel and cleans the dialog out of the DOM', async () => {
    const pending = dialogConfirm({ title: 'Confirm payment' });
    buttonLabelled('Cancel').click();
    await expect(pending).resolves.toBe(false);
    expect(modal()).toBeNull();
  });

  it('resolves false when dismissed with Esc (the dialog just fires close)', async () => {
    const pending = dialogConfirm({ title: 'Confirm payment' });
    modal()!.dispatchEvent(new Event('close'));
    await expect(pending).resolves.toBe(false);
  });

  it('shows details as a list instead of cramming them into one string', async () => {
    const pending = dialogConfirm({
      title: 'Confirm payment',
      details: [{ label: 'Amount', value: '1.5 ETH' }, { label: 'To', value: '0xabc' }],
      confirmLabel: 'Send',
    });
    const text = modal()!.textContent ?? '';
    expect(text).toContain('Amount');
    expect(text).toContain('1.5 ETH');
    expect(text).toContain('0xabc');
    buttonLabelled('Send').click();
    await pending;
  });
});

describe('dialogPrompt', () => {
  it('returns the trimmed input value', async () => {
    const pending = dialogPrompt({ title: 'Rename account', confirmLabel: 'Rename' });
    const input = document.querySelector('dialog.modal input') as HTMLInputElement;
    input.value = '  Treasury  ';
    buttonLabelled('Rename').click();
    await expect(pending).resolves.toBe('Treasury');
  });

  it('prefills an existing value', async () => {
    const pending = dialogPrompt({ title: 'Rename account', value: 'Account 2', confirmLabel: 'Rename' });
    const input = document.querySelector('dialog.modal input') as HTMLInputElement;
    expect(input.value).toBe('Account 2');
    buttonLabelled('Cancel').click();
    await pending;
  });

  it('returns null on cancel, and for an empty value', async () => {
    const cancelled = dialogPrompt({ title: 'Add account' });
    buttonLabelled('Cancel').click();
    await expect(cancelled).resolves.toBeNull();

    const blank = dialogPrompt({ title: 'Add account', confirmLabel: 'Add' });
    buttonLabelled('Add').click();
    await expect(blank).resolves.toBeNull();
  });

  it('submits on Enter', async () => {
    const pending = dialogPrompt({ title: 'Add account' });
    const input = document.querySelector('dialog.modal input') as HTMLInputElement;
    input.value = 'Payouts';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await expect(pending).resolves.toBe('Payouts');
  });
});

describe('dialogAlert', () => {
  it('resolves on OK and marks the error tone', async () => {
    const pending = dialogAlert({ title: "Couldn't rename", message: 'boom', tone: 'error' });
    expect(document.querySelector('dialog.modal .modal-title')!.classList).toContain('error');
    buttonLabelled('OK').click();
    await expect(pending).resolves.toBeUndefined();
    expect(modal()).toBeNull();
  });

  it('only ever opens one dialog per call', async () => {
    const pending = dialogAlert({ title: 'Sent' });
    expect(document.querySelectorAll('dialog.modal')).toHaveLength(1);
    buttonLabelled('OK').click();
    await pending;
    expect(document.querySelectorAll('dialog.modal')).toHaveLength(0);
  });
});
