import { Client, createClient } from '@libsql/client';
import {
  Injectable,
  OnModuleInit,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogReadReplica } from './catalog-read-replica';
import { assertDatabaseVersion, initializeDatabase } from './schema';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  readonly client: Client;
  private replica?: CatalogReadReplica;

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

  get readClient(): Client {
    return this.replica?.client ?? this.client;
  }

  async refreshReadReplica(): Promise<void> {
    await this.replica?.refresh();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.replica?.close();
    this.client.close();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.execute('PRAGMA foreign_keys = ON');
      if (this.configService.get<boolean>('DATABASE_AUTO_MIGRATE')) {
        await initializeDatabase(this.client);
      } else {
        await assertDatabaseVersion(this.client);
      }
      const path = this.configService.get<string>('TURSO_REPLICA_PATH');
      if (path) {
        this.replica = new CatalogReadReplica({
          path,
          syncUrl: this.configService.getOrThrow<string>('TURSO_DATABASE_URL'),
          authToken: this.configService.get<string>('TURSO_AUTH_TOKEN'),
          syncIntervalMs: this.configService.getOrThrow<number>(
            'TURSO_REPLICA_SYNC_MS',
          ),
        });
        await this.replica.start();
      }
    } catch (error: unknown) {
      await this.replica?.close();
      this.client.close();
      throw error;
    }
  }
}
