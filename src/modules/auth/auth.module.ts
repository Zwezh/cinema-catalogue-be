import { RefreshSessionRepository } from './refresh-session.repository';
import { AuthRequestGuard } from './auth-request.guard';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-guard';
import { JwtStrategy } from './jwt-strategy';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_KEY'),
        signOptions: { expiresIn: 900 },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthRepository,
    RefreshSessionRepository,
    AuthRequestGuard,
    AuthService,
    JwtAuthGuard,
    JwtStrategy,
    LoginRateLimitGuard,
  ],
  exports: [AuthService],
})
export class AuthModule {}
