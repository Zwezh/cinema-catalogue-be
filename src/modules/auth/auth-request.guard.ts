import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/** Refresh cookies are ambient credentials; reject untrusted origins and simple form requests. */
@Injectable()
export class AuthRequestGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.get('Origin');
    if (
      request.get('X-MediaShelf-Request') !== '1' ||
      !origin ||
      !this.config.getOrThrow<string[]>('CORS_ORIGINS').includes(origin)
    )
      throw new ForbiddenException('Untrusted authentication request');
    return true;
  }
}
