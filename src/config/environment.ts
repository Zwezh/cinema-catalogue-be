export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const providerToken = environment.KINOPOISK_API_TOKEN;
  if (
    providerToken !== undefined &&
    (typeof providerToken !== 'string' || !/^[\x21-\x7e]+$/.test(providerToken))
  ) {
    throw new Error(
      'KINOPOISK_API_TOKEN must be a nonempty printable token without whitespace',
    );
  }
  const jwtKey = environment.JWT_KEY;
  if (
    typeof jwtKey !== 'string' ||
    Buffer.byteLength(jwtKey) < 32 ||
    !jwtKey.trim()
  ) {
    throw new Error('JWT_KEY must contain at least 32 bytes');
  }
  const url = environment.TURSO_DATABASE_URL;
  if (
    typeof url !== 'string' ||
    !/^(file:|libsql:\/\/|https?:\/\/|wss?:\/\/)/.test(url)
  ) {
    throw new Error('TURSO_DATABASE_URL must be a supported database URL');
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') {
      if (!parsed.pathname || parsed.pathname === '/') throw new Error();
    } else if (!parsed.hostname || parsed.username || parsed.password) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'TURSO_DATABASE_URL must be a valid database URL without credentials',
    );
  }
  if (
    environment.NODE_ENV !== undefined &&
    !['development', 'production', 'test'].includes(
      String(environment.NODE_ENV),
    )
  ) {
    throw new Error('NODE_ENV must be development, production or test');
  }
  const production = environment.NODE_ENV === 'production';
  if (
    production &&
    !url.startsWith('file:') &&
    (typeof environment.TURSO_AUTH_TOKEN !== 'string' ||
      !environment.TURSO_AUTH_TOKEN.trim())
  ) {
    throw new Error(
      'TURSO_AUTH_TOKEN is required for a remote production database',
    );
  }
  const integer = (
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    const raw = environment[key] ?? fallback;
    if (
      (typeof raw !== 'string' && typeof raw !== 'number') ||
      String(raw).trim() === ''
    )
      throw new Error(`${key} must be an integer`);
    const result = Number(raw);
    if (!Number.isSafeInteger(result) || result < min || result > max)
      throw new Error(`${key} is outside the supported range`);
    return result;
  };
  const replicaPath = environment.TURSO_REPLICA_PATH;
  if (
    replicaPath !== undefined &&
    (typeof replicaPath !== 'string' ||
      (replicaPath !== '' && !replicaPath.trim()) ||
      replicaPath !== replicaPath.trim() ||
      replicaPath.includes('\0'))
  ) {
    throw new Error('TURSO_REPLICA_PATH must be a nonempty filesystem path');
  }
  if (replicaPath && url.startsWith('file:')) {
    throw new Error('TURSO_REPLICA_PATH requires a remote primary database');
  }
  const auto = environment.DATABASE_AUTO_MIGRATE ?? String(!production);
  if (auto !== 'true' && auto !== 'false')
    throw new Error('DATABASE_AUTO_MIGRATE must be true or false');
  const cors = environment.CORS_ORIGINS ?? 'https://cinema-catalogue.web.app';
  if (typeof cors !== 'string' || !cors.trim())
    throw new Error('CORS_ORIGINS must contain explicit origins');
  const origins = cors.split(',').map((origin) => origin.trim());
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin
    )
      throw new Error(
        'CORS_ORIGINS must contain HTTP(S) origins without paths',
      );
  }
  const sameSite = environment.REFRESH_COOKIE_SAMESITE ?? 'lax';
  if (sameSite !== 'lax' && sameSite !== 'none')
    throw new Error('REFRESH_COOKIE_SAMESITE must be lax or none');
  if (sameSite === 'none' && !production)
    throw new Error('SameSite=None refresh cookies require production HTTPS');
  return {
    ...environment,
    REFRESH_COOKIE_SAMESITE: sameSite,
    JWT_KEY: jwtKey,
    TURSO_DATABASE_URL: url,
    TURSO_REPLICA_PATH: replicaPath || undefined,
    TURSO_REPLICA_SYNC_MS: integer(
      'TURSO_REPLICA_SYNC_MS',
      30_000,
      1000,
      300_000,
    ),
    PORT: integer('PORT', 3000, 1, 65535),
    TRUST_PROXY_HOPS: integer('TRUST_PROXY_HOPS', 0, 0, 10),
    DATABASE_AUTO_MIGRATE: auto === 'true',
    CORS_ORIGINS: origins,
  };
}
