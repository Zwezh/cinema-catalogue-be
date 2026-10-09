import {
  BadRequestException,
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-guard';
import { KinopoiskService } from './kinopoisk.service';
import type { TitleAutofill } from './title-autofill.dto';

@Controller('kinopoisk')
@UseGuards(JwtAuthGuard)
export class KinopoiskController {
  constructor(private readonly service: KinopoiskService) {}

  @Get('titles/:id/autofill')
  getTitleAutofill(@Param('id') raw: string): Promise<TitleAutofill> {
    return this.service.getTitleAutofill(kinopoiskId(raw));
  }
}

function kinopoiskId(raw: string): number {
  const id = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id)) {
    throw new BadRequestException(
      'Kinopoisk ID must be a positive safe integer',
    );
  }
  return id;
}
