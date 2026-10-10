import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-guard';
import { WishlistService } from './wishlist.service';

@Controller('wishlist')
export class WishlistController {
  constructor(private readonly catalog: WishlistService) {}
  @Get() list(@Query() query: Record<string, unknown>) {
    return this.catalog.findAll(query);
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.catalog.findOne(id);
  }
  @UseGuards(JwtAuthGuard) @Post('from-kinopoisk') createFromKinopoisk(
    @Body() value: unknown,
  ) {
    return this.catalog.createFromKinopoisk(value);
  }
  @UseGuards(JwtAuthGuard) @Post(':id/refresh') @HttpCode(200) refresh(
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    return this.catalog.refresh(id, value);
  }
  @UseGuards(JwtAuthGuard) @Delete(':id') delete(@Param('id') id: string) {
    return this.catalog.delete(id);
  }
}
