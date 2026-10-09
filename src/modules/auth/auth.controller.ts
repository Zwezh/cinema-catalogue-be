import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { BodyValidationPipe } from '../../common/validation';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { validateLogin } from './login-validation';
import { AuthService } from './auth.service';
import { AuthRequestGuard } from './auth-request.guard';
import type { RefreshSession } from './refresh-session.repository';

@Controller('auth')
@UseGuards(AuthRequestGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @UseGuards(LoginRateLimitGuard)
  @Post()
  async signIn(
    @Body(new BodyValidationPipe(validateLogin)) body: { secretKey: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.signIn(body.secretKey);
    this.setCookie(response, result.session);
    return { access_token: result.access_token };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.authService.refresh(this.token(request));
      this.setCookie(response, result.session);
      return { access_token: result.access_token };
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException)
        response.clearCookie(this.cookieName(), this.cookieOptions());
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(this.token(request));
    response.setHeader('Cache-Control', 'no-store');
    response.clearCookie(this.cookieName(), this.cookieOptions());
  }

  private cookieName(): string {
    return this.config.get('NODE_ENV') === 'production'
      ? '__Host-media-shelf-refresh'
      : 'media-shelf-refresh';
  }
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: this.config.getOrThrow<'lax' | 'none'>(
        'REFRESH_COOKIE_SAMESITE',
      ),
      path: '/',
    };
  }
  private token(request: Request): string {
    return (
      request.headers.cookie
        ?.split(';')
        .map((value) => value.trim())
        .find((value) => value.startsWith(this.cookieName() + '='))
        ?.slice(this.cookieName().length + 1) ?? ''
    );
  }
  private setCookie(response: Response, session: RefreshSession): void {
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(this.cookieName(), session.token, {
      ...this.cookieOptions(),
      maxAge: Math.max(0, session.expiresAt - Date.now()),
    });
  }
}
