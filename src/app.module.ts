import { SeriesModule } from './modules/series/series.module';
import { WishlistModule } from './modules/wishlist/wishlist.module';
import { KinopoiskModule } from './modules/kinopoisk/kinopoisk.module';
import { validateEnvironment } from './config/environment';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { AuthModule, MoviesModule, SettingsModule } from './modules';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
    AuthModule,
    MoviesModule,
    SettingsModule,
    KinopoiskModule,
    SeriesModule,
    WishlistModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
