import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateOrderNumber } from './order-number';
import { customerIdentity } from './customer-normalize';
import {
  CreateManualOrderDto,
  ListOrdersQueryDto,
  ReviseOrderDto,
} from './dto/order.dto';

const orderLineInclude = {
  listingVariant: { select: { id: true, externalSku: true } },
  itemVariant: { select: { id: true, itemCode: true, name: true } },
  itemContentVersion: { select: { id: true, effectiveAt: true } },
  listingContentVersion: { select: { id: true, effectiveAt: true } },
} satisfies Prisma.OrderLineInclude;

const orderDetailInclude = {
  lines: { orderBy: { createdAt: 'asc' as const }, include: orderLineInclude },
  revisions: { orderBy: { createdAt: 'desc' as const } },
  notes: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      revisions: true,
      createdByUser: { select: { id: true, name: true } },
      updatedByUser: { select: { id: true, name: true } },
    },
  },
  _count: { select: { lines: true, notes: true } },
} satisfies Prisma.OrderInclude;

export type OrderDetail = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

function cleanSnapshot(dto: {
  name?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}): Prisma.InputJsonValue | undefined {
  const entries = Object.entries(dto).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as Prisma.InputJsonValue) : undefined;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Creates a manual order: title-only lines are valid free-form content (§10.2). */
  async createManual(dto: CreateManualOrderDto, userId: string): Promise<OrderDetail> {
    // Resolve variant links and their applicable content versions first
    // (§10.2: a linked Item or Listing pins its content-version reference).
    const resolvedLines = await Promise.all(
      dto.lines.map(async (line) => ({
        title: line.title,
        description: line.description,
        quantity: line.quantity ?? 1,
        itemVariantId: line.itemVariantId,
        listingVariantId: line.listingVariantId,
        itemContentVersionId: line.itemVariantId
          ? await this.latestItemVersionId(line.itemVariantId)
          : null,
        listingContentVersionId: line.listingVariantId
          ? await this.latestListingVersionId(line.listingVariantId)
          : null,
      })),
    );

    const order = await this.prisma.$transaction(async (tx) => {
      let created!: { id: string };
      // Internal Order Numbers are permanent identities: retry on collision.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          created = await tx.order.create({
            data: {
              source: 'manual',
              displayNumber: generateOrderNumber(),
              customerSnapshot: cleanSnapshot(dto.customer ?? {}) as Prisma.InputJsonValue | undefined,
              buyerNote: dto.buyerNote,
              giftInfo: (dto.giftInfo ?? undefined) as Prisma.InputJsonValue,
              deliveryMethod: dto.deliveryMethod,
              createdBy: userId,
              lines: {
                create: resolvedLines.map((line) => ({
                  ...line,
                  itemContentVersionId: line.itemContentVersionId ?? undefined,
                  listingContentVersionId: line.listingContentVersionId ?? undefined,
                })),
              },
            },
            select: { id: true },
          });
          break;
        } catch (error) {
          const known = error as Prisma.PrismaClientKnownRequestError;
          if (known.code !== 'P2002' || attempt === 4) throw error;
        }
      }

      const full = await tx.order.findUniqueOrThrow({
        where: { id: created.id },
        include: { lines: { include: orderLineInclude } },
      });
      // Original view (§11): the order as first created, never modified.
      await tx.order.update({
        where: { id: created.id },
        data: { rawSource: this.rawSourceOf(full) as Prisma.InputJsonValue },
      });
      return full;
    });

    await this.audit.record({
      actorId: userId,
      action: 'order.created_manual',
      objectType: 'Order',
      objectId: order.id,
      after: { displayNumber: order.displayNumber, lines: order.lines.length },
    });
    return this.get(order.id);
  }

  async list(query: ListOrdersQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.OrderWhereInput = {
      ...(query.source ? { source: query.source } : {}),
      ...(query.storeId ? { storeId: query.storeId } : {}),
      ...(query.archived
        ? { archivedAt: { not: null } }
        : { archivedAt: null, deletedAt: null }),
      ...(search
        ? {
            OR: [
              { displayNumber: { contains: search, mode: 'insensitive' } },
              { externalOrderId: { contains: search, mode: 'insensitive' } },
              { customerSnapshot: { path: ['name'], string_contains: search } },
              { customerSnapshot: { path: ['email'], string_contains: search } },
              { customerSnapshot: { path: ['phone'], string_contains: search } },
            ],
          }
        : {}),
    };
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          _count: { select: { lines: true, notes: true } },
          store: { select: { displayName: true, platform: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page! - 1) * query.pageSize!,
        take: query.pageSize!,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      orders,
      total,
      page: query.page!,
      pageSize: query.pageSize!,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize!)),
    };
  }

  async get(id: string): Promise<OrderDetail> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: orderDetailInclude,
    });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  /** Internal correction: reason mandatory, before/after per field (§11). */
  async revise(id: string, dto: ReviseOrderDto, userId: string): Promise<OrderDetail> {
    const before = await this.get(id);
    const customerSnapshot = dto.customer
      ? cleanSnapshot(dto.customer)
      : undefined;

    const order = await this.prisma.order.update({
      where: { id },
      data: {
        customerSnapshot: customerSnapshot as Prisma.InputJsonValue | undefined,
        buyerNote: dto.buyerNote,
        deliveryMethod: dto.deliveryMethod,
      },
      include: orderDetailInclude,
    });

    await this.prisma.orderRevision.create({
      data: {
        orderId: id,
        reason: dto.reason,
        before: {
          customerSnapshot: before.customerSnapshot,
          buyerNote: before.buyerNote,
          deliveryMethod: before.deliveryMethod,
        } as Prisma.InputJsonValue,
        after: {
          customerSnapshot: order.customerSnapshot,
          buyerNote: order.buyerNote,
          deliveryMethod: order.deliveryMethod,
        } as Prisma.InputJsonValue,
        userId,
      },
    });
    await this.audit.record({
      actorId: userId,
      action: 'order.revised',
      objectType: 'Order',
      objectId: id,
      metadata: { reason: dto.reason },
    });
    return this.get(id);
  }

  /** Archiving is a precondition for deletion (§22). */
  async archive(id: string, userId: string): Promise<OrderDetail> {
    const before = await this.get(id);
    if (before.archivedAt) return before;
    const order = await this.prisma.order.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: orderDetailInclude,
    });
    await this.audit.record({
      actorId: userId,
      action: 'order.archived',
      objectType: 'Order',
      objectId: id,
    });
    return order;
  }

  async restore(id: string, userId: string): Promise<OrderDetail> {
    const order = await this.prisma.order.update({
      where: { id },
      data: { archivedAt: null },
      include: orderDetailInclude,
    });
    await this.audit.record({
      actorId: userId,
      action: 'order.restored',
      objectType: 'Order',
      objectId: id,
    });
    return order;
  }

  /** Permanent removal after the archive precondition; keeps a minimal marker (§22). */
  async remove(id: string, userId: string, reason: string): Promise<void> {
    const order = await this.get(id);
    if (!order.archivedAt) {
      throw new ConflictException(
        'The order must be archived before it can be deleted.',
      );
    }
    await this.prisma.order.delete({ where: { id } });
    await this.audit.record({
      actorId: userId,
      action: 'order.permanently_deleted',
      objectType: 'Order',
      objectId: id,
      before: {
        displayNumber: order.displayNumber,
        source: order.source,
        externalOrderId: order.externalOrderId,
      },
      metadata: { reason, identityKeptToPreventSilentReimport: true },
    });
  }

  /**
   * Related orders for the customer section (§17): manually linked orders
   * plus normalized-field suggestions. Email/phone matches are strong,
   * address-only matches are weak; snapshots are never merged.
   */
  async related(id: string) {
    const order = await this.get(id);

    const links = await this.prisma.orderLink.findMany({
      where: { OR: [{ orderId: id }, { relatedOrderId: id }] },
      include: {
        order: { select: { id: true, displayNumber: true, customerSnapshot: true } },
        relatedOrder: { select: { id: true, displayNumber: true, customerSnapshot: true } },
      },
    });
    const linkedIds = new Set<string>([id]);
    const manual = links.map((link) => {
      const other =
        link.orderId === id
          ? { linkId: link.id, order: link.relatedOrder }
          : { linkId: link.id, order: link.order };
      linkedIds.add(other.order.id);
      return {
        linkId: other.linkId,
        orderId: other.order.id,
        displayNumber: other.order.displayNumber,
        customerSnapshot: other.order.customerSnapshot,
      };
    });

    const identity = customerIdentity(order.customerSnapshot);
    const strong: Array<Record<string, unknown>> = [];
    const weak: Array<Record<string, unknown>> = [];
    if (identity.email || identity.phone || identity.address) {
      const candidates = await this.prisma.order.findMany({
        where: { id: { notIn: [...linkedIds] }, deletedAt: null },
        select: {
          id: true,
          displayNumber: true,
          customerSnapshot: true,
          createdAt: true,
        },
        take: 500,
      });
      for (const candidate of candidates) {
        const other = customerIdentity(candidate.customerSnapshot);
        const view = {
          orderId: candidate.id,
          displayNumber: candidate.displayNumber,
          createdAt: candidate.createdAt,
          customerSnapshot: candidate.customerSnapshot,
        };
        if (
          (identity.email && other.email === identity.email) ||
          (identity.phone && other.phone === identity.phone)
        ) {
          strong.push(view);
        } else if (identity.address && other.address === identity.address) {
          weak.push(view);
        }
      }
    }

    return { manual, suggestions: { strong, weak } };
  }

  /** Manual link; the reverse direction counts as a duplicate too. */
  async link(id: string, relatedOrderId: string, userId: string) {
    if (id === relatedOrderId) {
      throw new ConflictException('An order cannot be linked to itself.');
    }
    await this.get(id);
    const related = await this.get(relatedOrderId);
    const duplicate = await this.prisma.orderLink.findFirst({
      where: { OR: [{ orderId: id, relatedOrderId }, { orderId: relatedOrderId, relatedOrderId: id }] },
    });
    if (duplicate) {
      throw new ConflictException('These orders are already linked.');
    }
    const link = await this.prisma.orderLink.create({
      data: { orderId: id, relatedOrderId, createdBy: userId },
    });
    await this.audit.record({
      actorId: userId,
      action: 'order.linked',
      objectType: 'Order',
      objectId: id,
      metadata: { relatedOrderId },
    });
    return { linkId: link.id, related: { orderId: related.id, displayNumber: related.displayNumber } };
  }

  async unlink(id: string, linkId: string, userId: string) {
    const link = await this.prisma.orderLink.findUnique({ where: { id: linkId } });
    if (!link || (link.orderId !== id && link.relatedOrderId !== id)) {
      throw new NotFoundException('Link not found for this order.');
    }
    await this.prisma.orderLink.delete({ where: { id: linkId } });
    await this.audit.record({
      actorId: userId,
      action: 'order.unlinked',
      objectType: 'Order',
      objectId: id,
      metadata: { relatedOrderId: link.orderId === id ? link.relatedOrderId : link.orderId },
    });
    return { ok: true };
  }

  private rawSourceOf(order: {
    displayNumber: string;
    source: string;
    customerSnapshot: Prisma.JsonValue | null;
    buyerNote: string | null;
    deliveryMethod: string | null;
    lines: Array<{
      title: string | null;
      quantity: number;
      description: string | null;
      itemVariant: { itemCode: string } | null;
    }>;
  }) {
    return {
      capturedAt: new Date().toISOString(),
      displayNumber: order.displayNumber,
      source: order.source,
      customerSnapshot: order.customerSnapshot,
      buyerNote: order.buyerNote,
      deliveryMethod: order.deliveryMethod,
      lines: order.lines.map((line) => ({
        title: line.title,
        quantity: line.quantity,
        description: line.description,
        itemCode: line.itemVariant?.itemCode ?? null,
      })),
    };
  }

  /** Latest item content version for the variant's item (§9: shared versions). */
  private async latestItemVersionId(itemVariantId: string): Promise<string | null> {
    const variant = await this.prisma.itemVariant
      .findUnique({
        where: { id: itemVariantId },
        select: { itemId: true },
      })
      .catch((error: Prisma.PrismaClientKnownRequestError) => {
        // P2023: the reference is not a valid variant id (e.g. a pasted code).
        if (error.code === 'P2023') {
          throw new NotFoundException(`Item variant not found: ${itemVariantId}`);
        }
        throw error;
      });
    if (!variant) throw new NotFoundException(`Item variant not found: ${itemVariantId}`);
    const version = await this.prisma.itemContentVersion.findFirst({
      where: { itemId: variant.itemId },
      orderBy: { effectiveAt: 'desc' },
      select: { id: true },
    });
    return version?.id ?? null;
  }

  private async latestListingVersionId(listingVariantId: string): Promise<string | null> {
    const variant = await this.prisma.listingVariant
      .findUnique({
        where: { id: listingVariantId },
        select: { listingId: true },
      })
      .catch((error: Prisma.PrismaClientKnownRequestError) => {
        if (error.code === 'P2023') {
          throw new NotFoundException(`Listing variant not found: ${listingVariantId}`);
        }
        throw error;
      });
    if (!variant) throw new NotFoundException(`Listing variant not found: ${listingVariantId}`);
    const version = await this.prisma.listingContentVersion.findFirst({
      where: { listingId: variant.listingId },
      orderBy: { effectiveAt: 'desc' },
      select: { id: true },
    });
    return version?.id ?? null;
  }
}
