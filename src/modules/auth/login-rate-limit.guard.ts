import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DatabaseService } from '../../database/database.service';

const windowMs = 60_000;
const attemptsPerWindow = 10;

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    // Express trusts the socket address by default. Do not trust client-supplied forwarding headers.
    const key = createHash('sha256')
      .update(request.ip ?? request.socket.remoteAddress ?? 'unknown')
      .digest('hex');
    const now = Date.now();
    const expires = now + windowMs;
    const [, result] = await this.database.client.batch(
      [
        {
          sql: 'DELETE FROM login_attempts WHERE expires_at <= ?',
          args: [now],
        },
        {
          sql: `INSERT INTO login_attempts (client_key, attempts, expires_at) VALUES (?, 1, ?)
          ON CONFLICT(client_key) DO UPDATE SET attempts = MIN(login_attempts.attempts + 1, 11)
          RETURNING attempts, expires_at`,
          args: [key, expires],
        },
      ],
      'write',
    );
    const row = result.rows[0];
    if (Number(row.attempts) > attemptsPerWindow) {
      const retryAfter = Math.max(
        1,
        Math.ceil((Number(row.expires_at) - now) / 1000),
      );
      http.getResponse<Response>().setHeader('Retry-After', retryAfter);
      throw new HttpException(
        'Too many login attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
