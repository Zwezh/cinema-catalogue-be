export function storedStringArray(value: unknown, field: string): string[] {
  const parsed: unknown = JSON.parse(String(value));
  if (
    !Array.isArray(parsed) ||
    (parsed as unknown[]).some((item) => typeof item !== 'string')
  ) {
    throw new Error(`Invalid stored JSON array: ${field}`);
  }
  return parsed as string[];
}
export function storedYear(value: unknown): number | number[] {
  const parsed: unknown = JSON.parse(String(value));
  const valid = (item: unknown): item is number =>
    typeof item === 'number' &&
    Number.isSafeInteger(item) &&
    item >= 1 &&
    item <= 9999;
  if (valid(parsed)) return parsed;
  if (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    (parsed as unknown[]).every(valid)
  )
    return parsed as number[];
  throw new Error('Invalid stored year JSON');
}

// Legacy series year ranges can contain an unknown end year. Preserve that marker.
export function storedSeriesYear(
  value: unknown,
): number | (number | null)[] | null {
  const parsed: unknown = JSON.parse(String(value));
  if (parsed === null) return null;
  if (
    Array.isArray(parsed) &&
    parsed.every(
      (item) =>
        item === null ||
        (typeof item === 'number' &&
          Number.isSafeInteger(item) &&
          item >= 1 &&
          item <= 9999),
    )
  )
    return parsed as (number | null)[];
  return storedYear(value);
}
