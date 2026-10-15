import { Module } from '@nestjs/common';
import { pgBossProvider } from './pg-boss.provider';

/**
 * Background job foundation. Business queues (Store synchronization,
 * webhook follow-ups, scheduled outbound Shipments, retries, tracking
 * providers) register their handlers on the shared pg-boss instance as
 * their milestones land.
 */
@Module({
  providers: [pgBossProvider],
  exports: [pgBossProvider],
})
export class JobsModule {}
