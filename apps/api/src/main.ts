import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(Number(process.env.API_PORT ?? 3000));
  console.log(`API listening at ${await app.getUrl()}`);
}

void bootstrap();
