import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-guard';
import { SeriesService } from './series.service';

@Controller('series')
export class SeriesController {
  constructor(private readonly catalog: SeriesService) {}
  @Get() list(@Query() query: Record<string, unknown>) {
    return this.catalog.findAll(query);
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.catalog.findOne(id);
  }
  @UseGuards(JwtAuthGuard) @Post() create(@Body() value: unknown) {
    return this.catalog.create(value);
  }
  @UseGuards(JwtAuthGuard) @Put(':id') update(
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    return this.catalog.update(id, value);
  }
  @UseGuards(JwtAuthGuard) @Delete(':id') delete(@Param('id') id: string) {
    return this.catalog.delete(id);
  }
}
