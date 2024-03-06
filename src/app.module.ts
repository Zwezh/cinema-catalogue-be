import { Module } from '@nestjs/common';
import { AuthModule, MoviesModule, SettingsModule } from './modules';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.DB_URL),
    AuthModule,
    MoviesModule,
    SettingsModule,
  ],
})
export class AppModule {}
