import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { credentialVersion } from './credential-version';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_KEY'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: unknown): Promise<{ userId: string }> {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('exp' in payload) ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000) ||
      !('sub' in payload) ||
      typeof payload.sub !== 'string' ||
      !('credentialVersion' in payload) ||
      typeof payload.credentialVersion !== 'string'
    ) {
      throw new UnauthorizedException();
    }
    const auth = await this.authService.findSecretKey();
    if (
      payload.sub !== auth.id ||
      payload.credentialVersion !== credentialVersion(auth.secretKey)
    ) {
      throw new UnauthorizedException();
    }
    return { userId: auth.id };
  }
}
