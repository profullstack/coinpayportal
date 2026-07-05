/**
 * Tiny DOM helpers. MV3 CSP forbids inline scripts/handlers, so all events are
 * wired via addEventListener here (never onclick="" attributes).
 */

type Props = Record<string, unknown>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (v !== undefined && v !== null && v !== false) {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) node.append(c);
  return node;
}

export function mount(...nodes: (Node | string)[]): void {
  const app = document.getElementById('app')!;
  app.replaceChildren(...nodes);
}

export function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  return el('button', { class: cls, type: 'button', onclick: onClick, text: label });
}

export function field(label: string, attrs: Props = {}): { row: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { class: 'input', ...attrs });
  const row = el('label', { class: 'field' }, [el('span', { class: 'label', text: label }), input]);
  return { row, input };
}

export function note(text: string, cls = 'muted'): HTMLElement {
  return el('p', { class: cls, text });
}
