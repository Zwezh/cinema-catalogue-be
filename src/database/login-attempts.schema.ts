export const loginAttemptsSchema = [
  `CREATE TABLE IF NOT EXISTS login_attempts (
    client_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_login_attempts_expiration ON login_attempts(expires_at)',
];
