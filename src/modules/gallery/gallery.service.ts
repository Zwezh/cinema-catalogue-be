import { Injectable } from '@nestjs/common';
import { GalleryRepository } from '../../database/gallery/gallery.repository';
import { validateGalleryQuery } from './gallery-query-validation';
@Injectable()
export class GalleryService {
  constructor(private readonly repository: GalleryRepository) {}
  findAll(query: unknown) {
    return this.repository.findAll(validateGalleryQuery(query));
  }
}
