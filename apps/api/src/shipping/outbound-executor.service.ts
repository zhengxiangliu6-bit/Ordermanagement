import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ShippingSettingsService } from './shipping-settings.service';
import { computeNextSendTime, type OutboundScheduleConfig } from './outbound-policy';
import {
  DEFAULT_TRACKING_JUMP,
  effectiveOwnSiteTemplate,
  readTrackingJump,
  type TrackingJumpConfig,
} from './tracking-jump';
import { RelayCommandError, RelayClient } from '../relay/relay.client';

/** Simulated outbound outcomes settable per Store (settings.simOutbound). */
export const SIM_OUTBOUND_OUTCOMES = [
  'synced',
  'partial',
  'failed',
  'not_supported',
] as const;

export type SimOutboundOutcome = (typeof SIM_OUTBOUND_OUTCOMES)[number];

export interface PlatformCapabilities {
  createFulfillment?: boolean;
  addTrackingNumber?: boolean;
  customTrackingUrl?: boolean;
  identifyCarrier?: boolean;
  markItemsFulfilled?: boolean;
  correctTracking?: boolean;
  customerNotification?: string;
}

export interface OutboundValues {
  /** Tracking number submitted to the platform (Attaky-facing or fallback). */
  trackingNumber: string;
  /** Tracking URL submitted to the platform, when supported at all. */
  trackingUrl: string | null;
  /** Mode actually used after capability fallback (§12.5). */
  publicTrackingMode: 'attaky' | 'carrier';
}

/**
 * §12.5 value selection under the store×carrier tracking model: the
 * store's jump mode + effective own-site template decide which surface the
 * platform buyer gets for transform carriers; carriers without a transform
 * always submit their original number/official URL; mode=carrier forces
 * the last-mile values. Pure.
 */
export function resolveOutboundValues(
  shipment: {
    attakyTrackingNumber: string | null;
    attakyTrackingUrl: string | null;
    originalTrackingNumber: string | null;
    carrierTrackingUrl: string | null;
  },
  capabilities: PlatformCapabilities,
  jump: TrackingJumpConfig = DEFAULT_TRACKING_JUMP,
  globalOwnSiteTemplate: string | null = null,
): OutboundValues | null {
  const canTakeUrl = capabilities.customTrackingUrl === true;

  if (jump.mode === 'carrier' && shipment.originalTrackingNumber !== null) {
    return {
      trackingNumber: shipment.originalTrackingNumber,
      trackingUrl: canTakeUrl ? shipment.carrierTrackingUrl : null,
      publicTrackingMode: 'carrier',
    };
  }

  const attakyUsable =
    shipment.attakyTrackingNumber !== null &&
    (!shipment.attakyTrackingUrl || canTakeUrl);
  if (attakyUsable && shipment.attakyTrackingNumber !== null) {
    const ownSiteTemplate = effectiveOwnSiteTemplate(jump, globalOwnSiteTemplate);
    let trackingUrl: string | null;
    if (ownSiteTemplate) {
      trackingUrl = canTakeUrl
        ? ownSiteTemplate.replace('{number}', shipment.attakyTrackingNumber)
        : null;
    } else {
      trackingUrl = canTakeUrl ? shipment.attakyTrackingUrl : null;
    }
    return {
      trackingNumber: shipment.attakyTrackingNumber,
      trackingUrl,
      publicTrackingMode: 'attaky',
    };
  }
  if (shipment.originalTrackingNumber !== null) {
    return {
      trackingNumber: shipment.originalTrackingNumber,
      trackingUrl: canTakeUrl ? shipment.carrierTrackingUrl : null,
      publicTrackingMode: 'carrier',
    };
  }
  return null;
}

interface OpResult {
  op: string;
  ok: boolean;
  /** transient failures are retried; permanent ones are not (§12.11). */
  errorType?: 'transient' | 'permanent';
  detail?: string;
}

/**
 * Relay/Shopify error classification (§12.11): connectivity and throttling
 * heal with time (retry inside the schedule); everything else — platform
 * rejections, permission gaps, configuration — is permanent.
 */
export function isTransientRelayCode(code: string): boolean {
  if (
    code === 'RELAY_TIMEOUT' ||
    code === 'RELAY_SUBMIT_FAILED' ||
    code === 'RELAY_PULL_FAILED'
  ) {
    return true;
  }
  if (code === 'HTTP_429') return true;
  const httpMatch = /^HTTP_(\d{3})$/.exec(code);
  return httpMatch !== null && Number(httpMatch[1]) >= 500;
}

export interface RelayFulfillmentOrderView {
  id: string;
  status: string;
  lineItems?: { nodes?: { remainingQuantity: number }[] } | null;
}

/** One fulfillment.create call: whole remaining quantity per fulfillment order. */
export function buildFulfillmentCreatePayload(
  fulfillmentOrder: Pick<RelayFulfillmentOrderView, 'id'>,
  values: OutboundValues,
  carrierName: string | null,
  notifyCustomer: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    fulfillmentOrderId: fulfillmentOrder.id,
    trackingNumber: values.trackingNumber,
    notifyCustomer,
  };
  if (carrierName) payload.trackingCompany = carrierName;
  if (values.trackingUrl) payload.trackingUrl = values.trackingUrl;
  return payload;
}

export interface ExecutionOutcome {
  remoteSyncStatus:
    | 'synced'
    | 'partially_synced'
    | 'scheduled'
    | 'manual_action_required'
    | 'not_supported';
  nextSendAt?: Date | null;
  attempts: number;
  ops: OpResult[];
  values: OutboundValues | null;
}

/**
 * Executes one outbound attempt for a due shipment against the simulated
 * platform adapter (M4c). Real adapters replace the sim dispatch at M5;
 * the state machine, retries, and idempotency stay.
 *
 * §12.11: synced only when the platform confirms every supported operation;
 * transient errors retry up to three times inside the schedule; explicit
 * unsupported responses are not retried; retries obey External Timezone.
 */
@Injectable()
export class OutboundExecutorService {
  private readonly logger = new Logger(OutboundExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: ShippingSettingsService,
    private readonly relay: RelayClient,
  ) {}

  async executeShipment(shipmentId: string, actorId: string | null = null): Promise<{
    skipped?: string;
    outcome?: ExecutionOutcome;
  }> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        order: { include: { store: true } },
        carrier: { select: { key: true, name: true } },
      },
    });
    if (!shipment) return { skipped: 'missing' };
    if (!shipment.order.store) return { skipped: 'manual_order' };
    // Idempotency: only due scheduled shipments execute.
    if (shipment.remoteSyncStatus !== 'scheduled') return { skipped: 'not_scheduled' };
    if (shipment.nextSendAt && shipment.nextSendAt.getTime() > Date.now()) {
      return { skipped: 'not_due' };
    }

    await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: { remoteSyncStatus: 'sending' },
    });

    const store = shipment.order.store;
    const capabilities = (store.capabilities ?? {}) as PlatformCapabilities;
    const storeSettings = (store.settings ?? {}) as {
      simOutbound?: SimOutboundOutcome;
      dataSource?: string;
      outbound?: { notifyCustomer?: boolean };
    };
    const simOutcome = storeSettings.simOutbound ?? 'synced';
    // §12.9: Shopify customer notification is a choice; test phase default off.
    const notifyCustomer = storeSettings.outbound?.notifyCustomer === true;

    const resolved = await this.settings.resolved();
    const jump = readTrackingJump(store.settings);
    const values = resolveOutboundValues(
      shipment,
      capabilities,
      jump,
      resolved.ownSiteTrackingUrlTemplate,
    );
    const priorResults = (shipment.platformResults ?? {}) as {
      attempts?: number;
      ops?: OpResult[];
    };
    const attempts = (priorResults.attempts ?? 0) + 1;

    // Capability gate: a platform that cannot create fulfillments at all is
    // Not Supported, regardless of the simulated outcome (§12.9/§12.11).
    let outcome: ExecutionOutcome;
    if (capabilities.createFulfillment !== true || values === null) {
      outcome = {
        remoteSyncStatus: 'not_supported',
        nextSendAt: null,
        attempts,
        ops: [
          {
            op: 'createFulfillment',
            ok: false,
            errorType: 'permanent',
            detail: 'Platform does not support fulfillment creation.',
          },
        ],
        values,
      };
    } else if (
      store.platform === 'shopify' &&
      storeSettings.dataSource === 'relay'
    ) {
      outcome = await this.dispatchRelay(
        shipment.order,
        shipment.carrier?.name ?? null,
        values,
        attempts,
        capabilities,
        notifyCustomer,
        resolved.schedule as OutboundScheduleConfig,
        resolved.timezone,
      );
    } else {
      outcome = await this.simulate(
        simOutcome,
        values,
        attempts,
        capabilities,
        resolved.schedule as OutboundScheduleConfig,
        resolved.timezone,
      );
    }

    await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        remoteSyncStatus: outcome.remoteSyncStatus,
        nextSendAt: outcome.nextSendAt ?? null,
        platformResults: {
          attempts: outcome.attempts,
          ops: outcome.ops,
          values: outcome.values,
          ...(shipment.carrier ? { carrierKey: shipment.carrier.key } : {}),
          lastExecutedAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    // A fully synced outbound means the platform is now fulfilled: reflect
    // it locally immediately (order list badges read statusRaw) instead of
    // waiting for the next import. The accepted-external base moves with
    // it so the next sync's platform echo compares as no-change (§15).
    if (outcome.remoteSyncStatus === 'synced') {
      const order = shipment.order;
      const currentStatusRaw = (order.statusRaw ?? {}) as Record<string, unknown>;
      const accepted = (order.lastAcceptedExternal ?? {}) as {
        statusRaw?: Record<string, unknown>;
      };
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          statusRaw: {
            ...currentStatusRaw,
            fulfillmentStatus: 'FULFILLED',
          } as unknown as Prisma.InputJsonValue,
          fulfillmentStatus: 'FULFILLED',
          lastAcceptedExternal: {
            ...accepted,
            statusRaw: {
              ...(accepted.statusRaw ?? currentStatusRaw),
              fulfillmentStatus: 'FULFILLED',
            },
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    await this.audit.record({
      actorId,
      action: 'shipment.outbound.attempt',
      objectType: 'shipment',
      objectId: shipmentId,
      after: {
        result: outcome.remoteSyncStatus,
        attempts: outcome.attempts,
        ops: outcome.ops.map((op) => ({ op: op.op, ok: op.ok, errorType: op.errorType })),
        valuesMode: outcome.values?.publicTrackingMode,
        simOutcome,
      },
    });
    this.logger.log(
      `Shipment ${shipmentId} outbound attempt ${outcome.attempts}: ${outcome.remoteSyncStatus}.`,
    );
    // Terminal failures carry the reason in ops[].detail — surface it in
    // the worker log so the terminal shows what needs human handling.
    if (
      outcome.remoteSyncStatus === 'manual_action_required' ||
      outcome.remoteSyncStatus === 'not_supported'
    ) {
      for (const op of outcome.ops) {
        if (!op.ok && op.detail) {
          this.logger.warn(
            `Shipment ${shipmentId} op "${op.op}" failed (${op.errorType}): ${op.detail}`,
          );
        }
      }
    }
    return { outcome };
  }

  /**
   * Real outbound dispatch through the Relay Worker (M6): fetch the order's
   * fulfillment orders live, then one fulfillment.create per open
   * fulfillment order covering its whole remaining quantity (M4
   * first-release shipments are whole-order, §12.2).
   *
   * Known limit: with multiple open fulfillment orders, a failure on a later
   * create after an earlier one succeeded retries the whole dispatch on the
   * next attempt; already-fulfilled orders then answer USER_ERRORS and stop
   * as permanent. Acceptable for the single-location dev store.
   */
  private async dispatchRelay(
    order: { externalOrderId: string | null },
    carrierName: string | null,
    values: OutboundValues,
    attempts: number,
    capabilities: PlatformCapabilities,
    notifyCustomer: boolean,
    schedule: OutboundScheduleConfig,
    timezone: string,
  ): Promise<ExecutionOutcome> {
    const transientFailure = (detail: string): ExecutionOutcome =>
      attempts >= 3
        ? {
            remoteSyncStatus: 'manual_action_required',
            nextSendAt: null,
            attempts,
            ops: [
              {
                op: 'createFulfillment',
                ok: false,
                errorType: 'transient',
                detail: `${detail} (retries exhausted).`,
              },
            ],
            values,
          }
        : {
            remoteSyncStatus: 'scheduled',
            nextSendAt: computeNextSendTime(schedule, new Date(), timezone),
            attempts,
            ops: [{ op: 'createFulfillment', ok: false, errorType: 'transient', detail }],
            values,
          };
    const permanentFailure = (detail: string): ExecutionOutcome => ({
      remoteSyncStatus: 'manual_action_required',
      nextSendAt: null,
      attempts,
      ops: [{ op: 'createFulfillment', ok: false, errorType: 'permanent', detail }],
      values,
    });

    if (!order.externalOrderId) {
      return permanentFailure('Order has no external id; cannot fulfill on the platform.');
    }

    try {
      const foResult = await this.relay.runCommand({
        kind: 'fulfillmentOrders.fetch',
        payload: { orderId: order.externalOrderId },
      });
      const fulfillmentOrders = (
        foResult.response as { fulfillmentOrders?: RelayFulfillmentOrderView[] }
      ).fulfillmentOrders ?? [];
      const open = fulfillmentOrders.filter(
        (fulfillmentOrder) =>
          fulfillmentOrder.status === 'OPEN' &&
          (fulfillmentOrder.lineItems?.nodes ?? []).some((line) => line.remainingQuantity > 0),
      );
      if (open.length === 0) {
        return permanentFailure(
          'No open fulfillment orders with remaining quantity on the platform (already fulfilled or closed).',
        );
      }

      const ops: OpResult[] = [];
      for (const fulfillmentOrder of open) {
        await this.relay.runCommand({
          kind: 'fulfillment.create',
          payload: buildFulfillmentCreatePayload(
            fulfillmentOrder,
            values,
            carrierName,
            notifyCustomer,
          ),
        });
        ops.push({ op: 'createFulfillment', ok: true });
      }
      ops.push({ op: 'attachTracking', ok: capabilities.addTrackingNumber === true });
      if (capabilities.customTrackingUrl === true && values.trackingUrl) {
        ops.push({ op: 'attachTrackingUrl', ok: true });
      }
      ops.push({ op: 'markItemsFulfilled', ok: capabilities.markItemsFulfilled === true });
      ops.push({ op: 'notifyCustomer', ok: true });
      const allOk = ops.every((op) => op.ok);
      return {
        remoteSyncStatus: allOk ? 'synced' : 'partially_synced',
        nextSendAt: null,
        attempts,
        ops,
        values,
      };
    } catch (error) {
      if (error instanceof RelayCommandError) {
        const detail = `${error.code}: ${error.message}`;
        return isTransientRelayCode(error.code)
          ? transientFailure(detail)
          : permanentFailure(detail);
      }
      return transientFailure(error instanceof Error ? error.message : String(error));
    }
  }

  /** Simulated platform dispatch (M5 swaps this for real adapters). */
  private async simulate(
    simOutcome: SimOutboundOutcome,
    values: OutboundValues,
    attempts: number,
    capabilities: PlatformCapabilities,
    schedule: OutboundScheduleConfig,
    timezone: string,
  ): Promise<ExecutionOutcome> {
    if (simOutcome === 'synced') {
      const ops: OpResult[] = [
        { op: 'createFulfillment', ok: true },
        { op: 'attachTracking', ok: capabilities.addTrackingNumber === true },
        ...(capabilities.customTrackingUrl === true && values.trackingUrl
          ? [{ op: 'attachTrackingUrl', ok: true }]
          : []),
        { op: 'markItemsFulfilled', ok: capabilities.markItemsFulfilled === true },
        { op: 'notifyCustomer', ok: true },
      ];
      const allOk = ops.every((op) => op.ok);
      return {
        remoteSyncStatus: allOk ? 'synced' : 'partially_synced',
        nextSendAt: null,
        attempts,
        ops,
        values,
      };
    }

    if (simOutcome === 'partial') {
      return {
        remoteSyncStatus: 'partially_synced',
        nextSendAt: null,
        attempts,
        ops: [
          { op: 'createFulfillment', ok: true },
          { op: 'attachTracking', ok: false, errorType: 'permanent', detail: 'Rejected by platform.' },
          { op: 'markItemsFulfilled', ok: true },
        ],
        values,
      };
    }

    if (simOutcome === 'not_supported') {
      return {
        remoteSyncStatus: 'not_supported',
        nextSendAt: null,
        attempts,
        ops: [
          { op: 'createFulfillment', ok: false, errorType: 'permanent', detail: 'Not supported.' },
        ],
        values,
      };
    }

    // failed: transient — retry up to three times, always inside the
    // External Timezone schedule (§12.11).
    if (attempts >= 3) {
      return {
        remoteSyncStatus: 'manual_action_required',
        nextSendAt: null,
        attempts,
        ops: [
          { op: 'createFulfillment', ok: false, errorType: 'transient', detail: 'Timeout (retries exhausted).' },
        ],
        values,
      };
    }
    return {
      remoteSyncStatus: 'scheduled',
      nextSendAt: computeNextSendTime(schedule, new Date(), timezone),
      attempts,
      ops: [
        { op: 'createFulfillment', ok: false, errorType: 'transient', detail: 'Timeout.' },
      ],
      values,
    };
  }
}
