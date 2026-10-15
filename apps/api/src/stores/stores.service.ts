import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RelayClient } from '../relay/relay.client';
import { SHOPIFY_REQUIRED_SCOPES } from '../platforms/relay-shopify.adapter';
import { validateTrackingJumpInput } from '../shipping/tracking-jump';
import type { StorePlatform } from './dto/store.dto';

/**
 * Platform capability profiles (§12.9): outbound behavior is
 * capability-driven; only options the platform can honor are ever shown.
 * `customerNotification` is platform-mandated for Etsy and shown as fixed.
 */
export const PLATFORM_CAPABILITIES: Record<StorePlatform, Record<string, unknown>> = {
  shopify: {
    createFulfillment: true,
    addTrackingNumber: true,
    customTrackingUrl: true,
    identifyCarrier: true,
    markItemsFulfilled: true,
    correctTracking: true,
    customerNotification: 'choice',
  },
  etsy: {
    createFulfillment: true,
    addTrackingNumber: true,
    customTrackingUrl: false,
    identifyCarrier: true,
    markItemsFulfilled: true,
    correctTracking: false,
    customerNotification: 'mandated',
  },
};

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly relay: RelayClient,
  ) {}

  async create(
    dto: {
      platform: StorePlatform;
      displayName: string;
      externalShopId?: string;
      externalShopName?: string;
    },
    userId: string,
  ) {
    const store = await this.prisma.store.create({
      data: {
        platform: dto.platform,
        displayName: dto.displayName,
        externalShopId: dto.externalShopId,
        externalShopName: dto.externalShopName,
        // New stores start paused; resuming requires an authorized action.
        connectionState: 'paused',
        capabilities: PLATFORM_CAPABILITIES[dto.platform] as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      actorId: userId,
      action: 'store.created',
      objectType: 'Store',
      objectId: store.id,
      after: { platform: store.platform, displayName: store.displayName },
    });
    return store;
  }

  list(filters: { platform?: string; connectionState?: string } = {}) {
    return this.prisma.store.findMany({
      where: {
        ...(filters.platform ? { platform: filters.platform } : {}),
        ...(filters.connectionState
          ? { connectionState: filters.connectionState }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { orders: true } } },
    });
  }

  /**
   * Deletes a store only when no orders reference it: order history is
   * immutable (§9.3) and must not lose its store context. Mis-created
   * stores can be removed; live stores are paused or disconnected instead.
   */
  async remove(id: string, userId: string): Promise<void> {
    const store = await this.get(id);
    const orderCount = await this.prisma.order.count({ where: { storeId: id } });
    if (orderCount > 0) {
      throw new ConflictException(
        'This store has orders and cannot be deleted; pause or disconnect it instead.',
      );
    }
    await this.prisma.store.delete({ where: { id } });
    await this.audit.record({
      actorId: userId,
      action: 'store.deleted',
      objectType: 'Store',
      objectId: id,
      before: {
        platform: store.platform,
        displayName: store.displayName,
        externalShopName: store.externalShopName,
      },
    });
  }

  async get(id: string) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException('Store not found.');
    return store;
  }

  async update(
    id: string,
    dto: {
      displayName?: string;
      settings?: Record<string, unknown>;
      shippingPolicyOverride?: Record<string, unknown>;
    },
    userId: string,
  ) {
    const before = await this.get(id);
    // settings is replaced wholesale; validate the tracking-jump slice it
    // may carry (per-store tracking surface, 2026-10-15) before storing.
    if (dto.settings !== undefined) {
      validateTrackingJumpInput(
        (dto.settings as { trackingJump?: unknown }).trackingJump,
      );
    }
    const store = await this.prisma.store.update({
      where: { id },
      data: {
        displayName: dto.displayName,
        settings: (dto.settings ?? undefined) as Prisma.InputJsonValue | undefined,
        // null clears the override; omitted leaves it unchanged (§12.8).
        shippingPolicyOverride:
          dto.shippingPolicyOverride === undefined
            ? undefined
            : dto.shippingPolicyOverride === null
              ? Prisma.JsonNull
              : (dto.shippingPolicyOverride as Prisma.InputJsonValue),
      },
    });
    await this.audit.record({
      actorId: userId,
      action: 'store.updated',
      objectType: 'Store',
      objectId: id,
      before: { displayName: before.displayName, settings: before.settings },
      after: { displayName: store.displayName, settings: store.settings },
    });
    return store;
  }

  async setConnectionState(id: string, state: 'paused' | 'connected', userId: string) {
    const before = await this.get(id);
    if (before.connectionState === state) return before;
    const store = await this.prisma.store.update({
      where: { id },
      data: { connectionState: state },
    });
    await this.audit.record({
      actorId: userId,
      action: state === 'paused' ? 'store.paused' : 'store.resumed',
      objectType: 'Store',
      objectId: id,
      before: { connectionState: before.connectionState },
      after: { connectionState: store.connectionState },
    });
    return store;
  }

  /**
   * M6 connect flow: verify the relay-backed Shopify connection at runtime
   * before the store may synchronize. The granted-scope check reflects the
   * store's actual app installation (releasing a new app version is not
   * enough — the store must approve the Update), and the shop-domain check
   * stops a relay configured for one store from feeding another store's row.
   */
  async connectShopify(
    id: string,
    dto: { importStartDate?: string },
    userId: string,
  ) {
    const store = await this.get(id);
    if (store.platform !== 'shopify') {
      throw new ConflictException({
        code: 'PLATFORM_NOT_SUPPORTED',
        message: 'Only Shopify stores can connect through the relay in this phase.',
      });
    }
    if (!this.relay.configured) {
      throw new ConflictException({
        code: 'RELAY_NOT_CONFIGURED',
        message:
          'The API has no relay credential: set RELAY_URL and RELAY_MACHINE_TOKEN in the API environment.',
      });
    }

    const { response } = await this.relay.runCommand({ kind: 'scopes.check' });
    const { shop, accessScopes } = response as {
      shop: { name: string; myshopifyDomain: string };
      accessScopes: string[];
    };

    if (store.externalShopName && store.externalShopName !== shop.myshopifyDomain) {
      throw new ConflictException({
        code: 'STORE_MISMATCH',
        message: `This relay serves ${shop.myshopifyDomain}, but the store is registered as ${store.externalShopName}.`,
      });
    }
    const missing = SHOPIFY_REQUIRED_SCOPES.filter(
      (scope) => !accessScopes.includes(scope),
    );
    if (missing.length > 0) {
      throw new ConflictException({
        code: 'SCOPES_MISSING',
        message: `The store has not approved all required scopes (missing: ${missing.join(', ')}). Approve the app Update in the store admin, then connect again.`,
      });
    }

    const settings = {
      ...((store.settings ?? {}) as Record<string, unknown>),
      dataSource: 'relay',
      relay: {
        shopDomain: shop.myshopifyDomain,
        shopName: shop.name,
        scopes: accessScopes,
        connectedAt: new Date().toISOString(),
      },
    };
    const importStartDate = dto.importStartDate
      ? new Date(dto.importStartDate)
      : store.importStartDate;

    const updated = await this.prisma.store.update({
      where: { id },
      data: {
        connectionState: 'connected',
        externalShopName: shop.myshopifyDomain,
        externalShopId: store.externalShopId ?? shop.myshopifyDomain,
        importStartDate: importStartDate ?? undefined,
        settings: settings as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      actorId: userId,
      action: 'store.connected',
      objectType: 'Store',
      objectId: id,
      after: {
        shopDomain: shop.myshopifyDomain,
        scopes: accessScopes.length,
        dataSource: 'relay',
      },
    });
    return { store: updated, shop, accessScopes };
  }

  /** Persists the outcome of a synchronization pass (§25 error surface). */
  async markSynced(id: string, error: { message: string; at: string } | null) {
    await this.prisma.store.update({
      where: { id },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: error ?? Prisma.JsonNull,
      },
    });
  }
}
