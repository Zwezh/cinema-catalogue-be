import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthRepository } from './auth.repository';
import { Auth } from './schemas';
import { credentialVersion } from './credential-version';
import { validateSecret } from './login-validation';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly jwtService: JwtService,
  ) {}

  async signIn(secretKey: string): Promise<{ access_token: string }> {
    secretKey = validateSecret(secretKey);
    const auth = await this.findSecretKey();
    const isMatch = await bcrypt.compare(secretKey, auth.secretKey);
    if (isMatch) {
      const payload = {
        sub: auth.id,
        credentialVersion: credentialVersion(auth.secretKey),
      };
      return {
        access_token: await this.jwtService.signAsync(payload),
      };
    }
    throw new UnauthorizedException();
  }

  async findSecretKey(): Promise<Auth> {
    const auth = await this.repository.findAdministrator();
    if (!auth) throw new UnauthorizedException();
    return auth;
  }
}
