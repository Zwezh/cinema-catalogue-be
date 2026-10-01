import { Client, createClient } from '@libsql/client';
import {
  Injectable,
  OnModuleInit,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertDatabaseVersion, initializeDatabase } from './schema';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  readonly client: Client;

  constructor(private readonly configService: ConfigService) {
    const url = configService.get<string>('TURSO_DATABASE_URL');
    if (!url) {
      throw new Error('TURSO_DATABASE_URL is required');
    }
    this.client = createClient({
      url,
      authToken: configService.get<string>('TURSO_AUTH_TOKEN'),
    });
  }

  onApplicationShutdown(): void {
    this.client.close();
  }

  async onModuleInit(): Promise<void> {
    try {
      if (this.configService.get<boolean>('DATABASE_AUTO_MIGRATE')) {
        await initializeDatabase(this.client);
      } else {
        await assertDatabaseVersion(this.client);
      }
    } catch (error: unknown) {
      this.client.close();
      throw error;
    }
  }
}
