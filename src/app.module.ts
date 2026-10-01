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
  ],
  controllers: [AppController],
})
export class AppModule {}
