import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  matchCarriers,
  previewForCarrier,
  type CarrierRuleSet,
  type PreviewOutcome,
} from './carrier-rules';
import {
  computeNextSendTime,
  evaluateOutboundEntry,
  type OutboundScheduleConfig,
  type SyncPolicyMode,
} from './outbound-policy';
import { ShippingSettingsService } from './shipping-settings.service';
import { displayTrackingUrl, readTrackingJump } from './tracking-jump';
import type { PackShipmentDto, ShipmentEntryDto, TailTrackingDto } from './dto/shipping.dto';

function toRuleSet(carrier: {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  recognition: Prisma.JsonValue | null;
  trackingUrlTemplate: string | null;
  attakyTransform: Prisma.JsonValue | null;
}): CarrierRuleSet {
  return {
    key: carrier.key,
    name: carrier.name,
    enabled: carrier.enabled,
    recognition: (carrier.recognition ?? {}) as never,
    trackingUrlTemplate: carrier.trackingUrlTemplate,
    attakyTransform: (carrier.attakyTransform ?? null) as never,
  };
}

interface CarrierRow {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  recognition: Prisma.JsonValue | null;
  trackingUrlTemplate: string | null;
  attakyTransform: Prisma.JsonValue | null;
}

export interface ShipmentCandidate {
  id: string;
  key: string;
  name: string;
  preview: PreviewOutcome | null;
}

export interface OutboundPlan {
  policyMode: SyncPolicyMode | 'not_applicable';
  remoteSyncStatus: string;
  plannedSendAt: Date | null;
  externalTimezone: string;
  customerNotification: 'choice' | 'mandated' | 'none';
}

/**
 * Shipment administrative entry (§12.3): recognize → (ambiguous/manual
 * choice) → preview → save the local shipping fact. Outbound execution is
 * M4c; this service records local state, the resolved policy, and the
 * next planned send time only.
 */
@Injectable()
export class ShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: ShippingSettingsService,
  ) {}

  async recognize(
    orderId: string,
    trackingNumber: string,
  ): Promise<
    | { kind: 'single'; carrier: ShipmentCandidate }
    | { kind: 'ambiguous'; candidates: ShipmentCandidate[] }
    | { kind: 'none'; carriers: ShipmentCandidate[] }
  > {
    await this.loadEnterableOrder(orderId);
    const carriers = await this.enabledCarriers();
    const match = matchCarriers(
      trackingNumber,
      carriers.map(toRuleSet),
    );
    if (match.kind === 'single') {
      const carrier = carriers.find((c) => c.key === match.carrier.key)!;
      return {
        kind: 'single',
        carrier: this.toCandidate(carrier, trackingNumber),
      };
    }
    if (match.kind === 'ambiguous') {
      return {
        kind: 'ambiguous',
        candidates: match.carriers.map((ruleSet) => {
          const carrier = carriers.find((c) => c.key === ruleSet.key)!;
          return this.toCandidate(carrier, trackingNumber);
        }),
      };
    }
    return {
      kind: 'none',
      carriers: carriers.map((c) => this.toCandidate(c, trackingNumber, false)),
    };
  }

  async preview(orderId: string, carrierId: string, trackingNumber: string) {
    const order = await this.loadEnterableOrder(orderId);
    const carrier = await this.loadEnabledCarrier(carrierId);
    const outcome = previewForCarrier(trackingNumber, toRuleSet(carrier));
    const plan = await this.outboundPlan(order);
    // Effective link preview under the store×carrier model so the entry
    // dialog shows what buyers will actually get, not the M4 fallback.
    const { ownSiteTrackingUrlTemplate } = await this.settings.resolved();
    const jump = readTrackingJump(order.store?.settings ?? null);
    const trackingLink = displayTrackingUrl(jump, ownSiteTrackingUrlTemplate, {
      attakyTrackingNumber: outcome.attakyTrackingNumber,
      originalTrackingNumber: outcome.normalizedNumber,
      attakyTrackingUrl: outcome.attakyTrackingUrl,
      carrierTrackingUrl: outcome.carrierTrackingUrl,
    });
    return {
      carrier: { ...this.toCandidateFromOutcome(carrier, outcome), trackingLink },
      plan,
    };
  }

  async create(orderId: string, dto: ShipmentEntryDto, userId: string) {
    const order = await this.loadEnterableOrder(orderId);

    const existing = await this.prisma.shipment.findFirst({
      where: { orderId },
    });
    if (existing) {
      throw new ConflictException(
        'This order already has a shipment; correct it instead (first release: one shipment per order).',
      );
    }

    const carrier = await this.loadEnabledCarrier(dto.carrierId);
    const ruleSet = toRuleSet(carrier);
    const outcome = previewForCarrier(dto.trackingNumber, ruleSet);

    // Recognition honesty for the audit trail (§12.14): re-derive how this
    // carrier came to be chosen — auto match, ambiguity resolution, or
    // manual selection with no rule match.
    const enabled = await this.enabledCarriers();
    const match = matchCarriers(
      dto.trackingNumber,
      enabled.map(toRuleSet),
    );
    const recognition =
      match.kind === 'single' && match.carrier.key === carrier.key
        ? 'auto'
        : match.kind === 'ambiguous' &&
            match.carriers.some((c) => c.key === carrier.key)
          ? 'ambiguous_choice'
          : 'manual';

    const plan = await this.outboundPlan(order);
    const dispatchedAt = dto.dispatchedAt ? new Date(dto.dispatchedAt) : new Date();

    let shipment;
    try {
      shipment = await this.prisma.shipment.create({
        data: {
          orderId,
          carrierId: carrier.id,
          originalTrackingNumber: outcome.normalizedNumber,
          attakyTrackingNumber: outcome.attakyTrackingNumber,
          carrierTrackingUrl: outcome.carrierTrackingUrl,
          attakyTrackingUrl: outcome.attakyTrackingUrl,
          publicTrackingMode: outcome.attakyTrackingNumber ? 'attaky' : 'carrier',
          dispatchedAt,
          enteredBy: userId,
          localStatus: 'dispatched',
          remoteSyncStatus: plan.remoteSyncStatus,
          ruleVersion: ruleSet.attakyTransform?.version ?? null,
          policyMode: plan.policyMode,
          nextSendAt: plan.plannedSendAt,
        },
        include: { carrier: { select: { key: true, name: true } } },
      });
    } catch (error) {
      // Global uniqueness of attakyTrackingNumber (§12.4 DB-level guard).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'The transformed Attaky tracking number already exists on another shipment.',
        );
      }
      throw error;
    }

    await this.audit.record({
      actorId: userId,
      action: 'shipment.entered',
      objectType: 'shipment',
      objectId: shipment.id,
      after: {
        orderId,
        carrierKey: carrier.key,
        recognition,
        originalTrackingNumber: outcome.normalizedNumber,
        attakyTrackingNumber: outcome.attakyTrackingNumber,
        publicTrackingMode: shipment.publicTrackingMode,
        ruleVersion: shipment.ruleVersion,
        policyMode: shipment.policyMode,
        remoteSyncStatus: shipment.remoteSyncStatus,
        nextSendAt: shipment.nextSendAt,
      },
      metadata: { rawInput: dto.trackingNumber },
    });

    // Review-required entries join the Outbound Shipping Review Queue (§12.10).
    if (plan.remoteSyncStatus === 'pending_review') {
      await this.queueForReview(
        shipment,
        order,
        'initial',
        null,
        carrier ? { key: carrier.key, name: carrier.name } : null,
      );
    }

    return shipment;
  }

  /**
   * M7b packing step: records weight/dimensions and creates the shipment
   * before a tracking number exists. The pipeline stage lives on the order.
   */
  async createPackedShipment(
    orderId: string,
    dto: PackShipmentDto,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ shipmentId: string; weightGrams: number; lengthCm: number; widthCm: number; heightCm: number }> {
    const db = tx ?? this.prisma;
    if (!tx) await this.loadEnterableOrder(orderId);
    const existing = await db.shipment.findFirst({
      where: { orderId, voidedAt: null },
    });
    if (existing) {
      throw new ConflictException('This order already has an active shipment.');
    }

    const weightGrams = Math.round(
      dto.weightUnit === 'kg' ? dto.weightValue * 1000 : dto.weightValue,
    );
    const toCm = (value: number) =>
      Math.round(dto.dimensionUnit === 'mm' ? value / 10 : dto.dimensionUnit === 'in' ? value * 2.54 : value);
    const lengthCm = toCm(dto.lengthValue);
    const widthCm = toCm(dto.widthValue);
    const heightCm = toCm(dto.heightValue);

    const shipment = await db.shipment.create({
      data: {
        orderId,
        weightGrams,
        lengthCm,
        widthCm,
        heightCm,
        packedBy: userId,
        packedAt: new Date(),
        enteredBy: userId,
        enteredAt: new Date(),
        localStatus: 'packed',
        remoteSyncStatus: 'not_applicable',
      },
      select: { id: true },
    });
    await this.audit.record({
      actorId: userId,
      action: 'shipment.packed',
      objectType: 'shipment',
      objectId: shipment.id,
      after: { orderId, weightGrams, lengthCm, widthCm, heightCm },
    }, tx);
    return { shipmentId: shipment.id, weightGrams, lengthCm, widthCm, heightCm };
  }

  /**
   * M7b ordering step: attaches carrier + tracking to the packed shipment.
   * Outbound write-back is intentionally deferred to inspection.
   */
  async setTrackingForPackedShipment(
    orderId: string,
    dto: ShipmentEntryDto,
    userId: string,
  ): Promise<{ shipmentId: string; carrierKey: string; originalTrackingNumber: string; attakyTrackingNumber: string | null }> {
    await this.loadEnterableOrder(orderId);
    const shipment = await this.prisma.shipment.findFirst({
      where: { orderId, voidedAt: null },
    });
    if (!shipment) {
      throw new ConflictException('Pack the order before entering a tracking number.');
    }
    if (shipment.carrierId || shipment.originalTrackingNumber) {
      throw new ConflictException('Tracking has already been entered for this shipment.');
    }

    const carrier = await this.loadEnabledCarrier(dto.carrierId);
    const ruleSet = toRuleSet(carrier);
    const outcome = previewForCarrier(dto.trackingNumber, ruleSet);
    const now = new Date();

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        carrierId: carrier.id,
        originalTrackingNumber: outcome.normalizedNumber,
        attakyTrackingNumber: outcome.attakyTrackingNumber,
        carrierTrackingUrl: outcome.carrierTrackingUrl,
        attakyTrackingUrl: outcome.attakyTrackingUrl,
        publicTrackingMode: outcome.attakyTrackingNumber ? 'attaky' : 'carrier',
        enteredBy: userId,
        enteredAt: now,
        trackingEnteredBy: userId,
        trackingEnteredAt: now,
        localStatus: 'prepared',
        remoteSyncStatus: 'not_applicable',
        ruleVersion: ruleSet.attakyTransform?.version ?? null,
      },
    });
    await this.audit.record({
      actorId: userId,
      action: 'shipment.tracking_entered',
      objectType: 'shipment',
      objectId: shipment.id,
      after: {
        orderId,
        carrierKey: carrier.key,
        originalTrackingNumber: outcome.normalizedNumber,
        attakyTrackingNumber: outcome.attakyTrackingNumber,
      },
    });
    return {
      shipmentId: shipment.id,
      carrierKey: carrier.key,
      originalTrackingNumber: outcome.normalizedNumber,
      attakyTrackingNumber: outcome.attakyTrackingNumber,
    };
  }

  /** M7b inspection: marks the physical shipment dispatched (push happens after). */
  async markInspected(shipmentId: string, userId: string): Promise<void> {
    await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        inspectedBy: userId,
        inspectedAt: new Date(),
        localStatus: 'dispatched',
        dispatchedAt: new Date(),
      },
    });
    await this.audit.record({
      actorId: userId,
      action: 'shipment.inspected',
      objectType: 'shipment',
      objectId: shipmentId,
    });
  }

  /** M7b tail tracking (cross-border carriers), can be added after shipping. */
  async setTailTracking(
    shipmentId: string,
    dto: TailTrackingDto,
    userId: string,
  ): Promise<void> {
    await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        tailTrackingNumber: dto.tailTrackingNumber.trim(),
        tailCarrier: dto.tailCarrier?.trim() || null,
        tailTrackingUrl: dto.tailTrackingUrl?.trim() || null,
        tailEnteredBy: userId,
        tailEnteredAt: new Date(),
      },
    });
    await this.audit.record({
      actorId: userId,
      action: 'shipment.tail_tracking_saved',
      objectType: 'shipment',
      objectId: shipmentId,
      after: { tailTrackingNumber: dto.tailTrackingNumber.trim() },
    });
  }

  /** §12.12 correction: new values + reason, then the REVISION policy. */
  async revise(
    orderId: string,
    shipmentId: string,
    dto: { reason: string; trackingNumber?: string; carrierId?: string },
    userId: string,
  ) {
    const order = await this.loadEnterableOrder(orderId);
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, orderId },
      include: { carrier: { select: { id: true, key: true, name: true } } },
    });
    if (!shipment) throw new NotFoundException('Shipment not found.');
    if (shipment.remoteSyncStatus === 'sending') {
      throw new ConflictException('Shipment is being sent; wait for the attempt to finish.');
    }

    const carrierId = dto.carrierId ?? shipment.carrierId;
    if (!carrierId) {
      throw new BadRequestException('A carrier is required for the revision.');
    }
    const carrier = await this.loadEnabledCarrier(carrierId);
    const trackingNumber = dto.trackingNumber ?? shipment.originalTrackingNumber ?? '';
    if (!trackingNumber) {
      throw new BadRequestException('A tracking number is required for the revision.');
    }
    const ruleSet = toRuleSet(carrier);
    const outcome = previewForCarrier(trackingNumber, ruleSet);

    const before = {
      carrierKey: shipment.carrier?.key ?? null,
      originalTrackingNumber: shipment.originalTrackingNumber,
      attakyTrackingNumber: shipment.attakyTrackingNumber,
      attakyTrackingUrl: shipment.attakyTrackingUrl,
      carrierTrackingUrl: shipment.carrierTrackingUrl,
      ruleVersion: shipment.ruleVersion,
      remoteSyncStatus: shipment.remoteSyncStatus,
      nextSendAt: shipment.nextSendAt,
    };

    const plan = await this.outboundPlan(order, 'revision');
    let revised;
    try {
      [revised] = await this.prisma.$transaction([
        this.prisma.shipment.update({
          where: { id: shipmentId },
          data: {
            carrierId: carrier.id,
            originalTrackingNumber: outcome.normalizedNumber,
            attakyTrackingNumber: outcome.attakyTrackingNumber,
            attakyTrackingUrl: outcome.attakyTrackingUrl,
            carrierTrackingUrl: outcome.carrierTrackingUrl,
            publicTrackingMode: outcome.attakyTrackingNumber ? 'attaky' : 'carrier',
            ruleVersion: ruleSet.attakyTransform?.version ?? null,
            policyMode: plan.policyMode,
            remoteSyncStatus: plan.remoteSyncStatus,
            nextSendAt: plan.plannedSendAt,
          },
        }),
        this.prisma.shipmentRevision.create({
          data: {
            shipmentId,
            reason: dto.reason,
            syncStatus: plan.remoteSyncStatus,
            userId,
            changes: { before, after: {
              carrierKey: carrier.key,
              originalTrackingNumber: outcome.normalizedNumber,
              attakyTrackingNumber: outcome.attakyTrackingNumber,
              attakyTrackingUrl: outcome.attakyTrackingUrl,
              carrierTrackingUrl: outcome.carrierTrackingUrl,
              ruleVersion: ruleSet.attakyTransform?.version ?? null,
            } } as unknown as Prisma.InputJsonValue,
          },
        }),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'The transformed Attaky tracking number already exists on another shipment.',
        );
      }
      throw error;
    }

    await this.audit.record({
      actorId: userId,
      action: 'shipment.revised',
      objectType: 'shipment',
      objectId: shipmentId,
      before,
      after: {
        reason: dto.reason,
        carrierKey: carrier.key,
        originalTrackingNumber: outcome.normalizedNumber,
        attakyTrackingNumber: outcome.attakyTrackingNumber,
        policyMode: plan.policyMode,
        remoteSyncStatus: plan.remoteSyncStatus,
        nextSendAt: plan.plannedSendAt,
      },
    });

    if (plan.remoteSyncStatus === 'pending_review') {
      const revision = await this.prisma.shipmentRevision.findFirst({
        where: { shipmentId },
        orderBy: { createdAt: 'desc' },
      });
      await this.queueForReview(
        revised,
        order,
        'revision',
        revision?.id ?? null,
        { key: carrier.key, name: carrier.name },
      );
    }

    return revised;
  }

  /** Approval callback from the review queue: schedule, never bypass (§12.8). */
  async approveOutbound(
    record: { id: string; subjectId: string | null },
    userId: string,
  ): Promise<void> {
    if (!record.subjectId) return;
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: record.subjectId },
    });
    if (!shipment) return;
    if (shipment.remoteSyncStatus !== 'pending_review') return;

    // policyMode snapshot holds the exact review_* mode that applied at
    // entry/revision; approval resolves it to immediate|scheduled.
    const mode = (shipment.policyMode ?? 'review_then_immediate').replace(
      'review_then_',
      '',
    );
    const { timezone, schedule } = await this.settings.resolved();
    const nextSendAt =
      mode === 'immediate'
        ? new Date()
        : computeNextSendTime(schedule as OutboundScheduleConfig, new Date(), timezone);

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: { remoteSyncStatus: 'scheduled', nextSendAt },
    });
    await this.audit.record({
      actorId: userId,
      action: 'shipment.outbound.approved',
      objectType: 'shipment',
      objectId: shipment.id,
      after: { nextSendAt, reviewRecordId: record.id },
    });
  }

  /** Rejection callback: the record returns for correction (§12.10/§12.12). */
  async rejectOutbound(
    record: { id: string; subjectId: string | null },
    userId: string,
  ): Promise<void> {
    if (!record.subjectId) return;
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: record.subjectId },
    });
    if (!shipment || shipment.remoteSyncStatus !== 'pending_review') return;
    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: { remoteSyncStatus: 'rejected', nextSendAt: null },
    });
    await this.audit.record({
      actorId: userId,
      action: 'shipment.outbound.rejected',
      objectType: 'shipment',
      objectId: shipment.id,
      metadata: { reviewRecordId: record.id },
    });
  }

  async list(orderId: string) {
    const shipments = await this.prisma.shipment.findMany({
      where: { orderId },
      orderBy: { enteredAt: 'asc' },
      include: {
        carrier: { select: { key: true, name: true } },
        order: { select: { store: { select: { settings: true } } } },
      },
    });
    if (shipments.length === 0) return [];
    // Effective tracking link per the store×carrier model (2026-10-15):
    // the stored attakyTrackingUrl is the M4 entry-time fallback; the link
    // buyers actually get follows the store's jump config.
    const { ownSiteTrackingUrlTemplate } = await this.settings.resolved();
    return shipments.map((shipment) => {
      const { order, ...row } = shipment;
      const jump = readTrackingJump(order.store?.settings ?? null);
      return {
        ...row,
        trackingLink: displayTrackingUrl(jump, ownSiteTrackingUrlTemplate, {
          attakyTrackingNumber: shipment.attakyTrackingNumber,
          originalTrackingNumber: shipment.originalTrackingNumber,
          attakyTrackingUrl: shipment.attakyTrackingUrl,
          carrierTrackingUrl: shipment.carrierTrackingUrl,
        }),
      };
    });
  }

  /**
   * Shipments list views (§24): all | scheduled | needs_attention. The
   * sensitive carrier pair is stripped for viewers without
   * carrier-source:read (§12.14).
   */
  async listViews(
    view: 'all' | 'scheduled' | 'needs_attention',
    storeId: string | undefined,
    page: number,
    pageSize: number,
    viewerPermissions: string[],
  ): Promise<{ shipments: unknown[]; total: number }> {
    const statusFilter: Record<string, { remoteSyncStatus: { in: string[] } }> = {
      scheduled: { remoteSyncStatus: { in: ['scheduled', 'sending'] } },
      needs_attention: {
        remoteSyncStatus: {
          in: [
            'partially_synced',
            'not_supported',
            'manual_action_required',
            'rejected',
            'failed',
          ],
        },
      },
      all: { remoteSyncStatus: { in: [
        'pending_review', 'scheduled', 'sending', 'synced',
        'partially_synced', 'not_supported', 'manual_action_required',
        'rejected', 'failed', 'not_applicable',
      ] } },
    };
    const where = {
      ...statusFilter[view],
      ...(storeId ? { order: { storeId } } : {}),
    };
    const canSeeSource = viewerPermissions.includes('carrier-source:read') ||
      viewerPermissions.includes('*');
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.shipment.findMany({
        where,
        orderBy: { enteredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          carrier: { select: { key: true, name: true } },
          order: {
            select: {
              id: true,
              displayNumber: true,
              store: { select: { id: true, displayName: true } },
            },
          },
        },
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return {
      shipments: rows.map((row) => ({
        id: row.id,
        orderId: row.orderId,
        orderNumber: row.order.displayNumber,
        storeName: row.order.store?.displayName ?? null,
        carrier: canSeeSource
          ? row.carrier
          : null,
        originalTrackingNumber: canSeeSource
          ? row.originalTrackingNumber
          : null,
        attakyTrackingNumber: row.attakyTrackingNumber,
        attakyTrackingUrl: row.attakyTrackingUrl,
        publicTrackingMode: row.publicTrackingMode,
        localStatus: row.localStatus,
        remoteSyncStatus: row.remoteSyncStatus,
        nextSendAt: row.nextSendAt,
        policyMode: row.policyMode,
        attempts: ((row.platformResults ?? {}) as { attempts?: number }).attempts ?? null,
        enteredAt: row.enteredAt,
      })),
      total,
    };
  }

  // ------------------------------------------------------------------ helpers

  private async loadEnterableOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        store: {
          select: {
            id: true,
            platform: true,
            displayName: true,
            shippingPolicyOverride: true,
            capabilities: true,
            settings: true,
          },
        },
      },
    });
    if (!order || order.deletedAt) throw new NotFoundException('Order not found.');
    if (order.archivedAt) {
      throw new BadRequestException('Archived orders cannot record shipments.');
    }
    // Platform-state gate (§12.1 lifecycle separation): an order the
    // platform already fully fulfilled (or cancelled) has nothing left for
    // Order Management to ship or push — entry is refused up-front with a
    // clear reason instead of failing later at outbound.
    const statusRaw = (order.statusRaw ?? {}) as {
      fulfillmentStatus?: string | null;
      cancelledAt?: string | null;
    };
    if (order.cancelledAt || statusRaw.cancelledAt) {
      throw new ConflictException({
        code: 'ORDER_CANCELLED',
        message: 'This order is cancelled; shipments cannot be recorded.',
      });
    }
    if (String(statusRaw.fulfillmentStatus ?? '').toUpperCase() === 'FULFILLED') {
      throw new ConflictException({
        code: 'ORDER_ALREADY_FULFILLED',
        message:
          'This order is already fulfilled on the platform; shipments cannot be recorded.',
      });
    }
    return order;
  }

  private async enabledCarriers(): Promise<CarrierRow[]> {
    return this.prisma.carrier.findMany({ where: { enabled: true } });
  }

  private async loadEnabledCarrier(id: string): Promise<CarrierRow> {
    const carrier = await this.prisma.carrier.findUnique({ where: { id } });
    if (!carrier || !carrier.enabled) {
      throw new NotFoundException('Carrier not found or disabled.');
    }
    return carrier;
  }

  private toCandidate(
    carrier: CarrierRow,
    trackingNumber: string,
    withPreview = true,
  ): ShipmentCandidate {
    return {
      id: carrier.id,
      key: carrier.key,
      name: carrier.name,
      preview: withPreview
        ? previewForCarrier(trackingNumber, toRuleSet(carrier))
        : null,
    };
  }

  private toCandidateFromOutcome(
    carrier: CarrierRow,
    outcome: PreviewOutcome,
  ): ShipmentCandidate {
    return { id: carrier.id, key: carrier.key, name: carrier.name, preview: outcome };
  }

  private async queueForReview(
    shipment: { id: string; orderId: string; attakyTrackingNumber: string | null; originalTrackingNumber: string | null; nextSendAt: Date | null; policyMode: string | null; ruleVersion: number | null },
    order: { storeId: string | null; displayNumber: string; store: { displayName?: string; capabilities?: Prisma.JsonValue | null } | null },
    kind: 'initial' | 'revision',
    revisionId: string | null,
    carrier: { key: string; name: string } | null,
  ): Promise<void> {
    const capabilities = (order.store?.capabilities ?? {}) as {
      customerNotification?: string;
    };
    const payload = {
      kind,
      revisionId,
      orderNumber: order.displayNumber,
      storeName: order.store?.displayName ?? null,
      // Sensitive pair (§12.14): stripped on read without carrier-source:read.
      carrierKey: carrier?.key ?? null,
      carrierName: carrier?.name ?? null,
      originalTrackingNumber: shipment.originalTrackingNumber,
      attakyTrackingNumber: shipment.attakyTrackingNumber,
      policyMode: shipment.policyMode,
      projectedSendAt: shipment.nextSendAt?.toISOString() ?? null,
      ruleVersion: shipment.ruleVersion,
      customerNotification: capabilities.customerNotification ?? 'none',
    };
    // Hash guard: one queue entry per shipment revision (§15 dedup shape).
    const payloadHash = createHash('sha256')
      .update(`${shipment.id}:${revisionId ?? 'initial'}`)
      .digest('hex');
    await this.prisma.reviewRecord.create({
      data: {
        type: 'shipment',
        storeId: order.storeId,
        subjectId: shipment.id,
        payloadHash,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * §12.8/§12.9/§12.13: which policy applies, the resulting Remote Sync
   * Status, and the planned send time. Manual orders skip outbound
   * synchronization entirely. `kind` selects the initial vs revision policy.
   */
  private async outboundPlan(
    order: {
      storeId: string | null;
      store: {
        shippingPolicyOverride: Prisma.JsonValue | null;
        capabilities: Prisma.JsonValue | null;
      } | null;
    },
    kind: 'initial' | 'revision' = 'initial',
  ): Promise<OutboundPlan> {
    const { timezone, schedule, defaults } = await this.settings.resolved();
    if (!order.store) {
      return {
        policyMode: 'not_applicable',
        remoteSyncStatus: 'not_applicable',
        plannedSendAt: null,
        externalTimezone: timezone,
        customerNotification: 'none',
      };
    }
    const override = (order.store.shippingPolicyOverride ?? null) as {
      initial?: string;
      revision?: string;
    } | null;
    const overridden = override?.[kind];
    const policyMode = (
      overridden && ['immediate', 'scheduled', 'review_then_immediate', 'review_then_scheduled'].includes(overridden)
        ? overridden
        : kind === 'initial'
          ? defaults.initial
          : defaults.revision
    ) as SyncPolicyMode;
    const evaluation = evaluateOutboundEntry(
      policyMode,
      schedule as OutboundScheduleConfig,
      new Date(),
      timezone,
    );
    // Review-required entries show the projected time for transparency:
    // approval recomputes; it never bypasses the schedule.
    let plannedSendAt = evaluation.nextSendAt;
    if (plannedSendAt === null) {
      plannedSendAt = computeNextSendTime(
        schedule as OutboundScheduleConfig,
        new Date(),
        timezone,
      );
    }
    const capabilities = (order.store.capabilities ?? {}) as {
      customerNotification?: string;
    };
    return {
      policyMode,
      remoteSyncStatus: evaluation.remoteSyncStatus,
      plannedSendAt,
      externalTimezone: timezone,
      customerNotification:
        (capabilities.customerNotification as OutboundPlan['customerNotification']) ??
        'none',
    };
  }
}
