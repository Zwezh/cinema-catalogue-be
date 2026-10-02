import { ConfigModule, ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import {
  importBackups,
  parseImportArguments,
  readImportFiles,
} from './import-data';

async function main(): Promise<void> {
  const options = parseImportArguments(process.argv.slice(2));
  // Parse and validate every record before opening or modifying a database.
  const data = readImportFiles(resolve(options.directory), options);
  await ConfigModule.forRoot();
  const config = new ConfigService();
  const { createClient } = await import('@libsql/client');
  const client = createClient({
    url: config.getOrThrow<string>('TURSO_DATABASE_URL'),
    authToken: config.get<string>('TURSO_AUTH_TOKEN'),
  });
  try {
    await importBackups(client, data, options.resetCatalogs);
    console.log(
      `Imported ${data.auth.length} auth record(s), ${data.movies.length} movie(s), and settings.`,
    );
  } finally {
    client.close();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
