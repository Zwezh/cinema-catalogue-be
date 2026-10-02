import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Auth } from './schemas';

@Injectable()
export class AuthRepository {
  constructor(private readonly database: DatabaseService) {}
  async findAdministrator(): Promise<Auth | undefined> {
    const result = await this.database.client.execute(
      'SELECT id, secret_key FROM auth_credentials ORDER BY id LIMIT 2',
    );
    if (result.rows.length > 1)
      throw new Error(
        'Multiple administrator records found; resolve explicitly before using authentication',
      );
    const row = result.rows[0];
    return row
      ? { id: String(row.id), secretKey: String(row.secret_key) }
      : undefined;
  }
}
