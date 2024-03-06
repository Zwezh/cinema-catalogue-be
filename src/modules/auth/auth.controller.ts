import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post()
  signIn(@Body() body: { secretKey: string }) {
    return this.authService.signIn(body.secretKey);
  }
}
