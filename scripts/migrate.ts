import { createClient } from '@libsql/client';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { initializeDatabase } from '../src/database/schema';

async function migrate(): Promise<void> {
  await ConfigModule.forRoot();
  const config = new ConfigService();
  const client = createClient({
    url: config.getOrThrow<string>('TURSO_DATABASE_URL'),
    authToken: config.get<string>('TURSO_AUTH_TOKEN'),
  });
  try {
    await initializeDatabase(client);
  } finally {
    client.close();
  }
}
void migrate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
