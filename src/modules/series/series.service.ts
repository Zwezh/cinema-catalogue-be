import { Injectable } from '@nestjs/common';
import { TitlesService } from '../../shared/titles/titles.service';
@Injectable()
export class SeriesService {
  constructor(private readonly titles: TitlesService) {}
  findAll(query: unknown) {
    return this.titles.findAll(query, 'library', true);
  }
  findOne(id: string) {
    return this.titles.findOne(id, 'library', true);
  }
  create(value: unknown) {
    return this.titles.create(value, 'library', true);
  }
  update(id: string, value: unknown) {
    return this.titles.update(id, value, 'library', true);
  }
  delete(id: string) {
    return this.titles.delete(id, 'library', true);
  }
}
