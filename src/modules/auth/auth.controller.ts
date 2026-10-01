import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { BodyValidationPipe } from '../../common/validation';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { validateLogin } from './login-validation';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(LoginRateLimitGuard)
  @Post()
  signIn(
    @Body(new BodyValidationPipe(validateLogin)) body: { secretKey: string },
  ) {
    return this.authService.signIn(body.secretKey);
  }
}
