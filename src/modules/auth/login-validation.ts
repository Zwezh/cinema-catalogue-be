import { BadRequestException } from '@nestjs/common';
import { objectBody, text } from '../../common/validation';

export function validateSecret(value: unknown): string {
  const secret = text(value, 'secretKey', 72);
  if (Buffer.byteLength(secret, 'utf8') > 72) {
    throw new BadRequestException('secretKey must not exceed 72 UTF-8 bytes');
  }
  return secret;
}
export function validateLogin(value: unknown): { secretKey: string } {
  const body = objectBody(value, ['secretKey']);
  return { secretKey: validateSecret(body.secretKey) };
}
