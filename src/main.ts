import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Personal-AI',
      'X-Token-Delivery',
    ],
  });
  // Local development stays on loopback. Do not publish this port.
  await app.listen(process.env.PORT ?? 3001, '127.0.0.1');
}
await bootstrap();
