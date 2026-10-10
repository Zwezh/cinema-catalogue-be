import { Controller, Get, Query } from '@nestjs/common';
import { GalleryService } from './gallery.service';
@Controller('gallery')
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}
  @Get() list(@Query() query: Record<string, unknown>) {
    return this.gallery.findAll(query);
  }
}
