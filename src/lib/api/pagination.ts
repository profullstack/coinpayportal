export function parsePaginationParam(
  value: string | null,
  defaultValue: number,
  options: { min?: number; max?: number } = {}
) {
  const raw = value?.trim() ?? '';
  const min = options.min ?? 0;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;

  if (!/^-?\d+$/.test(raw)) {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    return defaultValue;
  }

  return Math.min(Math.max(parsed, min), max);
}

