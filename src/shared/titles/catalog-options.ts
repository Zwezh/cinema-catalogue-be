import { createHash } from 'node:crypto';

export const catalogValueMaxLength = 100;
// Historical UTF-8 hex IDs remain accepted; new IDs have bounded digests.
export const catalogIdMaxLength = 1600;
export function optionId(
  type: 'quality' | 'extension' | 'genre',
  value: string,
): string {
  return `${type}:${createHash('sha256').update(value).digest('hex')}`;
}
