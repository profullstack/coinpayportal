'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COUNTRIES, type Country, resolveCountry, searchCountries } from '@/lib/countries';

interface CountrySelectProps {
  /** ISO 3166-1 alpha-2 code, or '' for none. */
  value: string;
  onChange: (code: string) => void;
  /** Restrict choices (e.g. Stripe Connect countries). Defaults to every ISO country. */
  countries?: readonly Country[] | readonly { code: string; name: string }[];
  disabled?: boolean;
  required?: boolean;
  id?: string;
  placeholder?: string;
  /** Classes for the text input; defaults to the light/dark dashboard style. */
  className?: string;
}

const DEFAULT_INPUT =
  'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 disabled:opacity-50 hover:border-purple-500 focus:outline-none focus:border-purple-500';

function label(c: { code: string; name: string }): string {
  return `${c.name.replace(/\s*\(the\)$/, '')} (${c.code})`;
}

/**
 * Type-ahead country picker. Type a name, alias, alpha-2 or alpha-3 code
 * ("Nigeria", "nga", "NG") and it resolves to the alpha-2 code; partial text
 * shows a ranked list to pick from with the mouse or arrow keys + Enter.
 */
export function CountrySelect({
  value,
  onChange,
  countries,
  disabled,
  required,
  id,
  placeholder = 'Type a country…',
  className,
}: CountrySelectProps) {
  // Lists that are not full Country records (Stripe's) get alpha3/numeric blanks.
  const list = useMemo<readonly Country[]>(
    () => (countries ? countries.map((c) => ({ alpha3: '', numeric: '', ...c })) : COUNTRIES),
    [countries]
  );
  const selected = useMemo(() => list.find((c) => c.code === value) ?? null, [list, value]);

  const [text, setText] = useState(selected ? label(selected) : '');
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Follow value changes made outside (data loaded, form reset) while not typing.
  useEffect(() => {
    if (!editing) setText(selected ? label(selected) : '');
  }, [selected, editing]);

  const query = selected && text === label(selected) ? '' : text;
  const filtered = useMemo(() => searchCountries(query, list), [query, list]);

  // Native validation: block submit on text that is not a country.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (value || (!required && !text.trim())) el.setCustomValidity('');
    else el.setCustomValidity(text.trim() ? 'Choose a country from the list' : 'Choose a country');
  }, [value, text, required]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setMenuPos({ top: r.bottom, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const pick = (c: Country) => {
    onChange(c.code);
    setText(label(c));
    setEditing(false);
    setOpen(false);
  };

  const onType = (next: string) => {
    setText(next);
    setEditing(true);
    setOpen(true);
    setActive(0);
    const hit = resolveCountry(next, list);
    if ((hit?.code ?? '') !== value) onChange(hit?.code ?? '');
  };

  const onBlur = () => {
    setOpen(false);
    setEditing(false);
    if (value) return; // useEffect restores the label
    if (text.trim() && filtered.length === 1) pick(filtered[0]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) {
        e.preventDefault();
        pick(filtered[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${filtered[active].code}` : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        value={text}
        onChange={(e) => onType(e.target.value)}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
          const i = selected ? filtered.findIndex((c) => c.code === selected.code) : 0;
          setActive(Math.max(i, 0));
        }}
        onClick={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={className ?? DEFAULT_INPUT}
      />
      {open && menuPos && typeof document !== 'undefined' &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            style={{ position: 'fixed', top: menuPos.top + 4, left: menuPos.left, width: menuPos.width }}
            className="z-50 max-h-64 overflow-y-auto py-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No matching country</li>
            ) : (
              filtered.map((c, i) => (
                <li
                  key={c.code}
                  id={`${listId}-${c.code}`}
                  data-index={i}
                  role="option"
                  aria-selected={c.code === value}
                  // mousedown, not click: keep focus so blur does not close the list first
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`cursor-pointer px-3 py-1.5 text-sm ${
                    i === active ? 'bg-purple-50 dark:bg-purple-900/30' : ''
                  } ${
                    c.code === value
                      ? 'text-purple-900 dark:text-purple-200 font-medium'
                      : 'text-gray-800 dark:text-gray-200'
                  }`}
                >
                  <span>{c.name.replace(/\s*\(the\)$/, '')}</span>
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{c.code}</span>
                </li>
              ))
            )}
          </ul>,
          document.body
        )}
    </>
  );
}
