import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../../database/database.service';
import { Auth } from './schemas';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private jwtService: JwtService,
  ) {}

  async signIn(secretKey: string): Promise<{ access_token: string }> {
    const auth = await this.findSecretKey();
    const isMatch = await bcrypt.compare(secretKey, auth.secretKey);
    if (isMatch) {
      const payload = { user: 'Aliaksei Zviazhynski' };
      return {
        access_token: await this.jwtService.signAsync(payload),
      };
    }
    throw new UnauthorizedException();
  }

  async findSecretKey(): Promise<Auth> {
    const result = await this.database.client.execute(
      'SELECT id, secret_key FROM auth ORDER BY id LIMIT 1',
    );
    const row = result.rows[0];
    if (!row) {
      throw new UnauthorizedException();
    }
    return { id: String(row.id), secretKey: String(row.secret_key) };
  }
}
