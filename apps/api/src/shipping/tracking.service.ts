import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ATTAKY_INTERNAL_PROVIDER_KEY,
  AttakyInternalTrackingProvider,
  TrackingProviderRegistry,
  type TrackingSnapshot,
} from './tracking-provider';
import { displayTrackingUrl, readTrackingJump } from './tracking-jump';
import { ShippingSettingsService } from './shipping-settings.service';

/**
 * Resolves the Tracking Provider for a shipment (§12.6): the carrier's
 * configured provider, else the first internal provider when an Attaky
 * tracking number exists, else no provider (URL fallback).
 */
@Injectable()
export class TrackingService {
  private readonly registry = new TrackingProviderRegistry([
    new AttakyInternalTrackingProvider(),
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ShippingSettingsService,
  ) {}

  /** Tracking data for one shipment, or the URL fallback (§12.6). */
  async forShipment(
    orderId: string,
    shipmentId: string,
  ): Promise<
    | { kind: 'provider'; snapshot: TrackingSnapshot }
    | { kind: 'fallback'; url: string | null }
  > {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, orderId },
      include: {
        carrier: { select: { trackingProviderId: true } },
        order: { select: { store: { select: { settings: true } } } },
      },
    });
    if (!shipment) throw new NotFoundException('Shipment not found.');
    // §12.6 display follows the store×carrier tracking model (2026-10-15):
    // the store's jump mode resolves against the global-default own-site
    // template; carriers without a transform keep their official link.
    const jump = readTrackingJump(shipment.order.store?.settings ?? null);
    const { ownSiteTrackingUrlTemplate } = await this.settings.resolved();
    const url = displayTrackingUrl(jump, ownSiteTrackingUrlTemplate, {
      attakyTrackingNumber: shipment.attakyTrackingNumber,
      originalTrackingNumber: shipment.originalTrackingNumber,
      attakyTrackingUrl: shipment.attakyTrackingUrl,
      carrierTrackingUrl: shipment.carrierTrackingUrl,
    });

    const providerRow = shipment.carrier?.trackingProviderId
      ? await this.prisma.trackingProvider.findUnique({
          where: { id: shipment.carrier.trackingProviderId },
        })
      : await this.ensureInternalProvider();

    const port = this.registry.resolve(providerRow?.key ?? null);
    const platformResults = (shipment.platformResults ?? {}) as {
      lastExecutedAt?: string;
    };
    const snapshot = port
      ? await port.fetch({
          attakyTrackingNumber: shipment.attakyTrackingNumber,
          originalTrackingNumber: shipment.originalTrackingNumber,
          attakyTrackingUrl: shipment.attakyTrackingUrl,
          carrierTrackingUrl: shipment.carrierTrackingUrl,
          enteredAt: shipment.enteredAt,
          dispatchedAt: shipment.dispatchedAt,
          remoteSyncStatus: shipment.remoteSyncStatus,
          lastExecutedAt: platformResults.lastExecutedAt ?? null,
        })
      : null;
    if (snapshot) {
      return {
        kind: 'provider',
        snapshot: {
          ...snapshot,
          link: url,
        },
      };
    }

    // No provider data: fall back to the applicable tracking URL (§12.6).
    return {
      kind: 'fallback',
      url,
    };
  }

  private async ensureInternalProvider() {
    const existing = await this.prisma.trackingProvider.findUnique({
      where: { key: ATTAKY_INTERNAL_PROVIDER_KEY },
    });
    if (existing) return existing;
    return this.prisma.trackingProvider.create({
      data: {
        key: ATTAKY_INTERNAL_PROVIDER_KEY,
        name: 'Attaky Internal Tracking',
        config: {} as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
