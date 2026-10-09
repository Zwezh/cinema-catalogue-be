import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthRepository } from './auth.repository';
import { Auth } from './schemas';
import { credentialVersion } from './credential-version';
import { validateSecret } from './login-validation';
import {
  RefreshSessionRepository,
  type RefreshSession,
} from './refresh-session.repository';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly sessions: RefreshSessionRepository,
  ) {}

  async signIn(
    secretKey: string,
  ): Promise<{ access_token: string; session: RefreshSession }> {
    secretKey = validateSecret(secretKey);
    const auth = await this.findSecretKey();
    const isMatch = await bcrypt.compare(secretKey, auth.secretKey);
    if (isMatch) {
      const session = await this.sessions.create(
        auth.id,
        credentialVersion(auth.secretKey),
      );
      return this.issue(auth, session);
    }
    throw new UnauthorizedException();
  }

  async refresh(
    token: string,
  ): Promise<{ access_token: string; session: RefreshSession }> {
    const auth = await this.findSecretKey();
    const session = await this.sessions.rotate(
      token,
      auth.id,
      credentialVersion(auth.secretKey),
    );
    if (!session) throw new UnauthorizedException();
    return this.issue(auth, session);
  }

  logout(token: string): Promise<void> {
    return this.sessions.revoke(token);
  }

  isSessionActive(id: string, auth: Auth): Promise<boolean> {
    return this.sessions.isActive(
      id,
      auth.id,
      credentialVersion(auth.secretKey),
    );
  }

  private async issue(
    auth: Auth,
    session: RefreshSession,
  ): Promise<{ access_token: string; session: RefreshSession }> {
    const access_token = await this.jwtService.signAsync({
      sub: auth.id,
      sid: session.id,
      credentialVersion: credentialVersion(auth.secretKey),
    });
    return { access_token, session };
  }

  async findSecretKey(): Promise<Auth> {
    const auth = await this.repository.findAdministrator();
    if (!auth) throw new UnauthorizedException();
    return auth;
  }
}
