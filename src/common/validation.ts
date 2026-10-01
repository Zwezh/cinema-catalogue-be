import { BadRequestException, PipeTransform } from '@nestjs/common';

export function objectBody(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('Body must be an object');
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !keys.includes(key))) {
    throw new BadRequestException('Body contains unsupported fields');
  }
  return body;
}

export function text(
  value: unknown,
  field: string,
  max = 1000,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  ) {
    throw new BadRequestException(
      `${field} must be a string of at most ${max} characters`,
    );
  }
  return value;
}

export function numberValue(
  value: unknown,
  field: string,
  min: number,
  max: number,
  integer = true,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new BadRequestException(
      `${field} must be a number between ${min} and ${max}`,
    );
  }
  return value;
}

export function strings(
  value: unknown,
  field: string,
  maxItems = 500,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new BadRequestException(
      `${field} must be an array of at most ${maxItems} strings`,
    );
  }
  return (value as unknown[]).map((item) => text(item, field));
}

export class BodyValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly parse: (value: unknown) => T) {}
  transform(value: unknown): T {
    return this.parse(value);
  }
}
