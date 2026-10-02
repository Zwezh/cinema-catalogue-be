import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TitlesModule } from '../../shared/titles/titles.module';
import { SeriesController } from './series.controller';
import { SeriesService } from './series.service';
@Module({
  imports: [AuthModule, TitlesModule],
  controllers: [SeriesController],
  providers: [SeriesService],
})
export class SeriesModule {}
