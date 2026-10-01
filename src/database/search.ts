export function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}
export function substringPattern(value: string): string {
  return `%${normalizeSearch(value).replace(/[\\%_]/g, '\\$&')}%`;
}
