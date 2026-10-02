import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Express } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const server = app.getHttpAdapter().getInstance() as Express;
  server.set('trust proxy', config.getOrThrow<number>('TRUST_PROXY_HOPS'));
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.getOrThrow<string[]>('CORS_ORIGINS'),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
