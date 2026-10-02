import { createHash } from 'node:crypto';

/** Fingerprint the stored bcrypt hash; never include the credential itself in JWTs. */
export function credentialVersion(hash: string): string {
  return createHash('sha256').update(hash).digest('hex');
}
