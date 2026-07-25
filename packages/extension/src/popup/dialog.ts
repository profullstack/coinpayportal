/**
 * Modal dialogs built on <dialog>.
 *
 * window.alert/confirm/prompt are a bad fit for an extension popup: they render
 * as browser chrome outside the popup's own styling, block the whole tab, and
 * in some Chromium builds dismissing them steals focus and closes the popup —
 * losing whatever the user had typed. <dialog> keeps the interaction inside our
 * own DOM, styled like the rest of the wallet.
 *
 * Each helper resolves when the dialog closes, so call sites read the same way
 * the native calls did (`await dialogConfirm(...)`).
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Lines rendered as a definition list — e.g. amount / chain / recipient. */
  details?: { label: string; value: string }[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive/irreversible. */
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
}

export interface AlertOptions {
  title: string;
  message?: string;
  details?: { label: string; value: string }[];
  tone?: 'ok' | 'error';
}

/**
 * Close a dialog, tolerating engines without the <dialog> methods (jsdom, and
 * anything predating the element). Removing `open` plus firing `close` matches
 * what a real implementation does, so the same code path drives both.
 */
function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === 'function') {
    dialog.close();
    return;
  }
  dialog.removeAttribute('open');
  dialog.dispatchEvent(new Event('close'));
}

/** Open a <dialog>, run `wire`, and resolve with whatever `wire` reports. */
function open<T>(
  build: (dialog: HTMLDialogElement, done: (value: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';

    let settled = false;
    const done = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
      closeDialog(dialog);
    };

    build(dialog, done);
    document.body.append(dialog);

    // Removing on close keeps the popup DOM clean across repeated opens.
    dialog.addEventListener('close', () => {
      dialog.remove();
      // Closed via Esc or the backdrop rather than a button.
      if (!settled) {
        settled = true;
        resolve(undefined as T);
      }
    });

    // jsdom (and very old engines) lack showModal; the open attribute still
    // renders and keeps the helpers testable.
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
}

function detailList(details: { label: string; value: string }[]): HTMLElement {
  const dl = document.createElement('dl');
  dl.className = 'modal-details';
  for (const d of details) {
    const dt = document.createElement('dt');
    dt.textContent = d.label;
    const dd = document.createElement('dd');
    dd.textContent = d.value;
    dl.append(dt, dd);
  }
  return dl;
}

function heading(title: string): HTMLElement {
  const h = document.createElement('h2');
  h.className = 'modal-title';
  h.textContent = title;
  return h;
}

function paragraph(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'modal-text';
  p.textContent = text;
  return p;
}

export function dialogConfirm(opts: ConfirmOptions): Promise<boolean> {
  return open<boolean>((dialog, done) => {
    const form = document.createElement('form');
    form.method = 'dialog';

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = opts.cancelLabel ?? 'Cancel';
    cancel.addEventListener('click', () => done(false));

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = `btn ${opts.danger ? 'danger' : 'primary'}`;
    ok.textContent = opts.confirmLabel ?? 'Confirm';
    ok.addEventListener('click', () => done(true));

    actions.append(cancel, ok);
    form.append(heading(opts.title));
    if (opts.message) form.append(paragraph(opts.message));
    if (opts.details?.length) form.append(detailList(opts.details));
    form.append(actions);
    dialog.append(form);

    // Enter confirms; Esc cancels via the dialog's own close event.
    queueMicrotask(() => ok.focus());
  }).then((v) => v === true);
}

export function dialogPrompt(opts: PromptOptions): Promise<string | null> {
  return open<string | null>((dialog, done) => {
    const form = document.createElement('form');
    form.method = 'dialog';

    const input = document.createElement('input');
    input.className = 'input';
    input.type = 'text';
    input.value = opts.value ?? '';
    if (opts.placeholder) input.placeholder = opts.placeholder;

    const label = document.createElement('label');
    label.className = 'field';
    if (opts.label) {
      const span = document.createElement('span');
      span.className = 'label';
      span.textContent = opts.label;
      label.append(span);
    }
    label.append(input);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => done(null));

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn primary';
    ok.textContent = opts.confirmLabel ?? 'Save';
    const submit = () => {
      const value = input.value.trim();
      done(value ? value : null);
    };
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    actions.append(cancel, ok);
    form.append(heading(opts.title), label, actions);
    dialog.append(form);

    queueMicrotask(() => {
      input.focus();
      input.select();
    });
  }).then((v) => (typeof v === 'string' ? v : null));
}

export function dialogAlert(opts: AlertOptions): Promise<void> {
  return open<void>((dialog, done) => {
    const form = document.createElement('form');
    form.method = 'dialog';

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn primary';
    ok.textContent = 'OK';
    ok.addEventListener('click', () => done(undefined));
    actions.append(ok);

    const title = heading(opts.title);
    if (opts.tone) title.classList.add(opts.tone === 'error' ? 'error' : 'ok');

    form.append(title);
    if (opts.message) form.append(paragraph(opts.message));
    if (opts.details?.length) form.append(detailList(opts.details));
    form.append(actions);
    dialog.append(form);

    queueMicrotask(() => ok.focus());
  });
}
