import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(cookieParser());
  app.enableCors({ origin: env().APP_URL, credentials: true });
  app.enableShutdownHooks();
  await app.listen(env().PORT);
  Logger.log(`API listening on :${env().PORT}`, 'Bootstrap');
}
bootstrap();
