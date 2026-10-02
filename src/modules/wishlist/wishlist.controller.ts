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
import { BodyValidationPipe } from '../../common/validation';
import { validatePromotion } from './promotion-validation';
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
  @UseGuards(JwtAuthGuard) @Post(':id/promote') promote(
    @Param('id') id: string,
    @Body(new BodyValidationPipe(validatePromotion))
    body: { addedDate: string },
  ) {
    return this.catalog.promote(id, body.addedDate);
  }
}
