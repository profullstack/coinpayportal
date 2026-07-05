export function parsePaginationParam(
  value: string | null,
  defaultValue: number,
  options: { min?: number; max?: number } = {}
) {
  const parsed = Number.parseInt(value ?? '', 10);
  const min = options.min ?? 0;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;

  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.min(Math.max(parsed, min), max);
}

