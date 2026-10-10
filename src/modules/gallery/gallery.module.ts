import { Module } from '@nestjs/common';
import { GalleryRepository } from '../../database/gallery/gallery.repository';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';
@Module({
  controllers: [GalleryController],
  providers: [GalleryService, GalleryRepository],
})
export class GalleryModule {}
