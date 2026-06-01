'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STRIPE_CONNECT_COUNTRIES } from '@/lib/stripe/connect-countries';

interface CountrySelectProps {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  id?: string;
}

export function CountrySelect({ value, onChange, disabled, id }: CountrySelectProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => STRIPE_CONNECT_COUNTRIES.find((c) => c.code === value) || null,
    [value]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return STRIPE_CONNECT_COUNTRIES;
    return STRIPE_CONNECT_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  }, [filter]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);
      if (!insideTrigger && !insideMenu) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Position the portaled menu under the trigger, and keep it aligned on
  // scroll/resize. Using a portal + fixed positioning lets the dropdown escape
  // ancestor `overflow-hidden` containers (e.g. the tab card) that would
  // otherwise crop it.
  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        setMenuPos({ top: rect.bottom, left: rect.left, width: rect.width });
      }
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  const handleSelect = (code: string) => {
    onChange(code);
    setOpen(false);
    setFilter('');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 disabled:opacity-50 hover:border-purple-500 dark:hover:border-purple-500"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? '' : 'text-gray-400 dark:text-gray-500'}>
          {selected ? `${selected.name} (${selected.code})` : 'Select a country'}
        </span>
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && menuPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top + 4, left: menuPos.left, width: menuPos.width }}
          className="z-50 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg"
        >
          <div className="p-2 border-b border-gray-200 dark:border-gray-800">
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter countries…"
              className="w-full px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-purple-500"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No matches</li>
            ) : (
              filtered.map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => handleSelect(c.code)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-purple-50 dark:hover:bg-purple-900/30 ${
                      c.code === value
                        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-900 dark:text-purple-200 font-medium'
                        : 'text-gray-800 dark:text-gray-200'
                    }`}
                    role="option"
                    aria-selected={c.code === value}
                  >
                    <span>{c.name}</span>
                    <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{c.code}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}
