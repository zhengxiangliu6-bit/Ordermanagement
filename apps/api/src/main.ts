import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './swagger';

async function lanAddresses(port: number): Promise<string[]> {
  const os = await import('node:os');
  const addresses: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(`http://${net.address}:${port}`);
      }
    }
  }
  return addresses;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: true, credentials: true });

  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  console.log('Order Management API ready (prefix /api/v1)');
  console.log(`  local: http://localhost:${port}/api/v1/health`);
  for (const address of await lanAddresses(port)) {
    console.log(`  LAN:   ${address}/api/v1/health`);
  }
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
