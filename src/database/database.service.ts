import { Client, createClient } from '@libsql/client';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeDatabase } from './schema';

@Injectable()
export class DatabaseService implements OnModuleInit {
  readonly client: Client;

  constructor(configService: ConfigService) {
    const url = configService.get<string>('TURSO_DATABASE_URL');
    if (!url) {
      throw new Error('TURSO_DATABASE_URL is required');
    }
    this.client = createClient({
      url,
      authToken: configService.get<string>('TURSO_AUTH_TOKEN'),
    });
  }

  async onModuleInit(): Promise<void> {
    await initializeDatabase(this.client);
  }
}
