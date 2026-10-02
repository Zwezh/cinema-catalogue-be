import { BadRequestException } from '@nestjs/common';
import { text } from '../../common/validation';

export function providerId(value: unknown): string | null {
  if (value == null) return null;
  const id = text(value, 'kpId', 100).trim();
  if (
    !/^\d+$/.test(id) ||
    BigInt(id) < 1n ||
    BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new BadRequestException(
      'kpId must be a positive safe decimal integer',
    );
  return BigInt(id).toString();
}
