import {
  BadRequestException,
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-guard';
import { KinopoiskService } from './kinopoisk.service';
import { MovieAutofill } from './movie-autofill.dto';

@Controller('kinopoisk')
@UseGuards(JwtAuthGuard)
export class KinopoiskController {
  constructor(private readonly service: KinopoiskService) {}

  @Get('movies/:id/autofill')
  getMovieAutofill(@Param('id') raw: string): Promise<MovieAutofill> {
    const id = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id)) {
      throw new BadRequestException(
        'Kinopoisk ID must be a positive safe integer',
      );
    }
    return this.service.getMovieAutofill(id);
  }
}
