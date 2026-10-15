import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };
import { AppModule } from './app.module';
import { PG_BOSS } from './jobs/pg-boss.provider';
import { OutboundSchedulerService } from './shipping/outbound-scheduler.service';

/**
 * Background job runner entry point (separate runtime process from the API;
 * architecture §2.1/§2.3, framework decision 2.6).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const boss = app.get<PgBoss>(PG_BOSS);

  boss.on('error', (error) => console.error('[pg-boss]', error));

  // pg-boss opens its database connection in start(); queues and handlers
  // are registered afterwards (createQueue asserts an open connection).
  await boss.start();

  // M4b: scheduled outbound shipments (cron scheduler + send-queue stub).
  // Later milestones register here: Store synchronization · webhook
  // follow-ups · retry processing · tracking-provider work.
  const scheduler = app.get(OutboundSchedulerService);
  await scheduler.register(boss);

  console.log('Order Management worker ready (pg-boss started)');

  const shutdown = async (signal: string) => {
    console.log(`worker stopping (${signal})`);
    await boss.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
