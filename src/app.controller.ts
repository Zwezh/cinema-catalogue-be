import { Controller, Get } from '@nestjs/common';

@Controller('')
export class AppController {
  @Get()
  getNothing(): string {
    return 'Hi!';
  }
}
