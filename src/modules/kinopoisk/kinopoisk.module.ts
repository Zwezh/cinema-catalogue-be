import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KinopoiskController } from './kinopoisk.controller';
import { KinopoiskService } from './kinopoisk.service';
import { KinopoiskClient, KINOPOISK_FETCH } from './kinopoisk.client';

@Module({
  imports: [AuthModule],
  controllers: [KinopoiskController],
  providers: [
    KinopoiskService,
    KinopoiskClient,
    { provide: KINOPOISK_FETCH, useValue: globalThis.fetch },
  ],
})
export class KinopoiskModule {}
