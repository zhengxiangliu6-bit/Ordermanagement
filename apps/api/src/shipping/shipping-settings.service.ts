import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ShippingSettingsPatchDto } from './dto/shipping.dto';
import {
  DEFAULT_OUTBOUND_SCHEDULE,
  InvalidScheduleError,
  isSyncPolicyMode,
  validateScheduleConfig,
  type OutboundScheduleConfig,
  type SyncPolicyDefaults,
} from './outbound-policy';
import { validateOwnSiteTemplate } from './tracking-jump';

/**
 * Global shipping settings (§12.7/§12.8): the one External Timezone, the
 * global-default Initial / Revision sync policies, and the outbound
 * schedule window. A single row (id "singleton") is created lazily with
 * first-release defaults; the settings UI arrives in M4d.
 */
@Injectable()
export class ShippingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get() {
    const row = await this.prisma.shippingSettings.findUnique({
      where: { id: 'singleton' },
    });
    if (row) return row;
    return this.prisma.shippingSettings.create({
      data: {
        id: 'singleton',
        schedule: DEFAULT_OUTBOUND_SCHEDULE as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Resolved defaults + schedule for the shipment entry flow. */
  async resolved(): Promise<{
    timezone: string;
    schedule: OutboundScheduleConfig;
    defaults: SyncPolicyDefaults;
    /** Global-default own-site tracking URL template (tracking-jump model). */
    ownSiteTrackingUrlTemplate: string | null;
  }> {
    const row = await this.get();
    return {
      timezone: row.externalTimezone,
      schedule: row.schedule as unknown as OutboundScheduleConfig,
      defaults: {
        initial: row.initialSyncPolicy as SyncPolicyDefaults['initial'],
        revision: row.revisionSyncPolicy as SyncPolicyDefaults['revision'],
      },
      ownSiteTrackingUrlTemplate: row.ownSiteTrackingUrlTemplate ?? null,
    };
  }

  async update(dto: ShippingSettingsPatchDto, actorId: string) {
    const current = await this.get();
    const schedule = dto.schedule
      ? (dto.schedule as unknown as OutboundScheduleConfig)
      : (current.schedule as unknown as OutboundScheduleConfig);
    try {
      if (dto.schedule) validateScheduleConfig(schedule);
      if (dto.externalTimezone) {
        // Reject unknown IANA zones up-front (computeNextSendTime would).
        new Intl.DateTimeFormat('en-US', { timeZone: dto.externalTimezone });
      }
      if (
        dto.ownSiteTrackingUrlTemplate !== undefined &&
        dto.ownSiteTrackingUrlTemplate !== null
      ) {
        try {
          validateOwnSiteTemplate(dto.ownSiteTrackingUrlTemplate);
        } catch (templateError) {
          throw new BadRequestException(
            templateError instanceof Error
              ? templateError.message
              : 'Invalid own-site tracking template.',
          );
        }
      }
    } catch (error) {
      if (error instanceof InvalidScheduleError || error instanceof RangeError) {
        throw new BadRequestException(
          error instanceof RangeError
            ? `Unknown timezone: ${dto.externalTimezone}`
            : error.message,
        );
      }
      throw error;
    }

    const ownSiteTrackingUrlTemplate =
      dto.ownSiteTrackingUrlTemplate === undefined
        ? (current.ownSiteTrackingUrlTemplate ?? null)
        : dto.ownSiteTrackingUrlTemplate === null || dto.ownSiteTrackingUrlTemplate.trim() === ''
          ? null
          : dto.ownSiteTrackingUrlTemplate.trim();

    const updated = await this.prisma.shippingSettings.update({
      where: { id: 'singleton' },
      data: {
        externalTimezone: dto.externalTimezone ?? current.externalTimezone,
        initialSyncPolicy: dto.initialSyncPolicy ?? current.initialSyncPolicy,
        revisionSyncPolicy: dto.revisionSyncPolicy ?? current.revisionSyncPolicy,
        schedule: schedule as unknown as Prisma.InputJsonValue,
        ownSiteTrackingUrlTemplate,
      },
    });

    await this.audit.record({
      actorId,
      action: 'shipping_settings.updated',
      objectType: 'shipping_settings',
      objectId: 'singleton',
      before: {
        externalTimezone: current.externalTimezone,
        initialSyncPolicy: current.initialSyncPolicy,
        revisionSyncPolicy: current.revisionSyncPolicy,
        schedule: current.schedule,
      },
      after: {
        externalTimezone: updated.externalTimezone,
        initialSyncPolicy: updated.initialSyncPolicy,
        revisionSyncPolicy: updated.revisionSyncPolicy,
        schedule: updated.schedule,
      },
    });
    return updated;
  }

  /** Effective INITIAL policy for an order's store (§12.8): per-Store
   *  override, else the global default. Entry is always the initial policy;
   *  the revision policy applies to corrections (M4c). */
  async effectiveInitialPolicy(storeOverride: unknown): Promise<string> {
    const { defaults } = await this.resolved();
    const override = (storeOverride ?? null) as {
      initial?: string;
    } | null;
    const overridden = override?.initial;
    if (overridden !== undefined) {
      if (!isSyncPolicyMode(overridden)) {
        throw new BadRequestException(
          'Invalid initial policy override stored on Store.',
        );
      }
      return overridden;
    }
    return defaults.initial;
  }
}
