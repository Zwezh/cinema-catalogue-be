import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-guard';
import { StatisticsService } from './statistics.service';
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statistics: StatisticsService) {}
  @Get() get(@Query() query: Record<string, unknown>) {
    if (Object.keys(query).length)
      throw new BadRequestException('Statistics does not accept filters');
    return this.statistics.get();
  }
  @Post('scan')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  scan(@Body() body: unknown, @Query() query: Record<string, unknown>) {
    if (
      Object.keys(query).length ||
      (body !== undefined &&
        (body === null ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length))
    )
      throw new BadRequestException(
        'Statistics scan does not accept parameters',
      );
    return this.statistics.scan();
  }
}
