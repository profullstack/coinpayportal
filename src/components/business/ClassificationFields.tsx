'use client';

import { useMemo, useState } from 'react';
import {
  BUSINESS_CATEGORIES,
  CATEGORY_GROUPS,
  MAX_TAGS,
  classifyBusiness,
  getCategory,
  normalizeTags,
  suggestCategories,
  suggestTags,
  type RiskLevel,
} from '@/lib/business/taxonomy';

export interface ClassificationValue {
  category: string;
  tags: string[];
}

interface ClassificationFieldsProps {
  value: ClassificationValue;
  onChange: (value: ClassificationValue) => void;
  /** Used to suggest a category and to preview the risk level. */
  name?: string;
  description?: string;
  disabled?: boolean;
}

const RISK_STYLES: Record<RiskLevel, string> = {
  low: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800',
  medium:
    'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800',
  high: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800',
  prohibited:
    'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800',
};

const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'Standard',
  medium: 'Standard — extra detail helps',
  high: 'Needs review before going live',
  prohibited: 'Not supported',
};

export function ClassificationFields({
  value,
  onChange,
  name = '',
  description = '',
  disabled = false,
}: ClassificationFieldsProps) {
  const [tagDraft, setTagDraft] = useState('');

  const categorySuggestions = useMemo(
    () => suggestCategories(`${name} ${description}`),
    [name, description]
  );

  const tagSuggestions = useMemo(
    () =>
      suggestTags(tagDraft, value.category, 6).filter((tag) => !value.tags.includes(tag)),
    [tagDraft, value.category, value.tags]
  );

  // Preview only — the server re-runs the same classifier on save.
  const preview = useMemo(
    () =>
      classifyBusiness({
        name,
        description,
        category: value.category,
        tags: value.tags,
      }),
    [name, description, value.category, value.tags]
  );

  const addTag = (raw: string) => {
    const [tag] = normalizeTags([raw]);
    if (!tag || value.tags.includes(tag) || value.tags.length >= MAX_TAGS) {
      setTagDraft('');
      return;
    }
    onChange({ ...value, tags: [...value.tags, tag] });
    setTagDraft('');
  };

  const removeTag = (tag: string) => {
    onChange({ ...value, tags: value.tags.filter((t) => t !== tag) });
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (!tagDraft.trim()) return;
      e.preventDefault();
      addTag(tagDraft);
      return;
    }
    if (e.key === 'Backspace' && !tagDraft && value.tags.length > 0) {
      removeTag(value.tags[value.tags.length - 1]);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="category"
          className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2"
        >
          Category *
        </label>
        <select
          id="category"
          required
          disabled={disabled}
          value={value.category}
          onChange={(e) => onChange({ ...value, category: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-white dark:bg-gray-700"
        >
          <option value="">Select a category…</option>
          {CATEGORY_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {BUSINESS_CATEGORIES.filter((c) => c.group === group).map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {categorySuggestions.length > 0 && !value.category && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Looks like:</span>
            {categorySuggestions.map((s) => (
              <button
                key={s.slug}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...value, category: s.slug })}
                className="px-2 py-1 rounded-full border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label
          htmlFor="tags"
          className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2"
        >
          Keywords
        </label>

        <div className="w-full px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus-within:ring-2 focus-within:ring-purple-500 dark:bg-gray-700 flex flex-wrap gap-2">
          {value.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 text-sm"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                disabled={disabled}
                onClick={() => removeTag(tag)}
                className="text-purple-500 hover:text-purple-800 dark:hover:text-white"
              >
                ×
              </button>
            </span>
          ))}
          <input
            id="tags"
            type="text"
            disabled={disabled || value.tags.length >= MAX_TAGS}
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => tagDraft.trim() && addTag(tagDraft)}
            className="flex-1 min-w-[8rem] px-2 py-1 bg-transparent outline-none text-gray-900 dark:text-white"
            placeholder={
              value.tags.length >= MAX_TAGS
                ? `Limit ${MAX_TAGS} keywords`
                : 'e.g. streaming, iptv — press Enter'
            }
          />
        </div>

        {tagSuggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {tagSuggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                disabled={disabled}
                onClick={() => addTag(tag)}
                className="px-2 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                + {tag}
              </button>
            ))}
          </div>
        )}

        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          What do you actually sell? These help us route your account correctly.
        </p>
      </div>

      {value.category && (
        <div className={`border rounded-lg p-3 text-sm ${RISK_STYLES[preview.riskLevel]}`}>
          <div className="font-medium">{RISK_LABELS[preview.riskLevel]}</div>
          {preview.riskLevel !== 'low' && preview.flags.length > 0 && (
            <ul className="mt-1 list-disc list-inside space-y-0.5">
              {preview.flags.slice(0, 4).map((flag) => (
                <li key={flag.code}>
                  {flag.label}
                  {flag.matched.length > 0 && ` (${flag.matched.slice(0, 3).join(', ')})`}
                </li>
              ))}
            </ul>
          )}
          {preview.reviewRequired && (
            <p className="mt-1">
              We&apos;ll review this before it can accept payments. You can still finish
              setup now.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Small read-only badge for list and detail views. */
export function CategoryBadge({
  category,
  riskLevel,
}: {
  category?: string | null;
  riskLevel?: RiskLevel | null;
}) {
  const def = getCategory(category);
  if (!def) return null;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs ${
        riskLevel ? RISK_STYLES[riskLevel] : RISK_STYLES.low
      }`}
    >
      {def.label}
    </span>
  );
}
