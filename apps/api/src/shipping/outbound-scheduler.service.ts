import { Injectable, Logger } from '@nestjs/common';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundExecutorService } from './outbound-executor.service';

/** Queue names registered with pg-boss. */
export const SCHEDULER_QUEUE = 'outbound-scheduler';
export const OUTBOUND_SEND_QUEUE = 'outbound-shipment.send';

/**
 * Outbound shipment scheduler (§12.7/§12.11): a cron-driven queue that
 * finds shipments whose nextSendAt is due and enqueues them for execution.
 * The send handler executes through the outbound executor (M4c): capability
 * checks, simulated platform writes, retries, and idempotency live there.
 */
@Injectable()
export class OutboundSchedulerService {
  private readonly logger = new Logger(OutboundSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: OutboundExecutorService,
  ) {}

  /** Where-clause for shipments due for outbound execution. */
  static dueWhere(now: Date): Prisma.ShipmentWhereInput {
    return {
      remoteSyncStatus: 'scheduled',
      nextSendAt: { lte: now },
    };
  }

  async enqueueDueShipments(boss: PgBoss): Promise<number> {
    const due = await this.prisma.shipment.findMany({
      where: OutboundSchedulerService.dueWhere(new Date()),
      select: { id: true },
    });
    for (const shipment of due) {
      // singletonKey: one pending send job per shipment, deduplicated
      // across scheduler ticks until the M4c executor completes it.
      await boss.send(
        OUTBOUND_SEND_QUEUE,
        { shipmentId: shipment.id },
        { singletonKey: `shipment:${shipment.id}` },
      );
    }
    if (due.length > 0) {
      this.logger.log(`Enqueued ${due.length} due shipment(s) for outbound execution.`);
    }
    return due.length;
  }

  /** Registers scheduler + send handlers on the shared pg-boss instance. */
  async register(boss: PgBoss): Promise<void> {
    await boss.createQueue(SCHEDULER_QUEUE);
    await boss.createQueue(OUTBOUND_SEND_QUEUE);

    // Every minute: find due shipments and hand them to the send queue.
    await boss.schedule(SCHEDULER_QUEUE, '* * * * *', {});
    await boss.work(SCHEDULER_QUEUE, async () => {
      await this.enqueueDueShipments(boss);
    });

    // M4c: execute due shipments through the outbound executor (simulated
    // adapter; real platform adapters arrive with the Relay Worker at M5).
    await boss.work(OUTBOUND_SEND_QUEUE, async (jobs) => {
      for (const job of jobs) {
        const { shipmentId } = job.data as { shipmentId?: string };
        if (!shipmentId) continue;
        try {
          await this.executor.executeShipment(shipmentId);
        } catch (error) {
          // A failed attempt must not crash the worker; the scheduler
          // re-enqueues due shipments on the next tick.
          this.logger.error(
            `Outbound execution failed for shipment ${shipmentId}: ${String(error)}`,
          );
        }
      }
    });
  }
}
