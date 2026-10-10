import { KinopoiskModule } from '../kinopoisk/kinopoisk.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TitlesModule } from '../../shared/titles/titles.module';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';
@Module({
  imports: [AuthModule, TitlesModule, KinopoiskModule],
  controllers: [WishlistController],
  providers: [WishlistService],
})
export class WishlistModule {}
