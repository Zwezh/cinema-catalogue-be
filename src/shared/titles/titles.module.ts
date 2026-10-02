import { Module } from '@nestjs/common';
import { TitlesRepository } from '../../database/titles/titles.repository';
import { TitlesService } from './titles.service';
@Module({
  providers: [TitlesRepository, TitlesService],
  exports: [TitlesService],
})
export class TitlesModule {}
