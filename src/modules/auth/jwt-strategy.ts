import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_KEY'),
    });
  }

  validate(payload: unknown): { user: string } {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('user' in payload) ||
      typeof payload.user !== 'string' ||
      !payload.user.trim()
    ) {
      throw new UnauthorizedException();
    }
    return { user: payload.user };
  }
}
