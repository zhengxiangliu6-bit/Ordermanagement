import { orderDetailLineImages } from './order-line-images';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateOrderNumber } from './order-number';
import { InventoryService } from '../inventory/inventory.service';
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
  // M7: the detail view shows the assigned shipping method and category
  // (same shape as list).
  shippingRegion: { select: { id: true, name: true } },
  shippingMethod: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  stageEvents: { orderBy: { createdAt: 'asc' as const } },
  problemItems: { orderBy: { reportedAt: 'desc' as const } },
  addOns: {
    orderBy: { createdAt: 'asc' as const },
    include: { itemVariant: { select: { id: true, itemCode: true, name: true } } },
  },
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
    private readonly inventory: InventoryService,
  ) {}

  /** Creates a manual order: title-only lines are valid free-form content (§10.2). */
  /**
   * M7 R2: duplicate an order as an editable manual order (re-ship flow -
   * same or corrected address, possibly adjusted products). The copy links
   * back to the original as a related order.
   */
  /** M7: update shipping-method/category assignment after approval. */
  async updateAssignment(
    orderId: string,
    dto: {
      shippingRegionId?: string | null;
      shippingMethodId?: string | null;
      categoryId?: string | null;
    },
    userId: string,
  ): Promise<OrderDetail> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.deletedAt) throw new ConflictException('Order is deleted.');

    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!category) throw new NotFoundException('Category not found.');
    }
    if (dto.shippingRegionId) {
      const region = await this.prisma.shippingRegion.findUnique({
        where: { id: dto.shippingRegionId },
      });
      if (!region) throw new NotFoundException('Shipping region not found.');
    }
    if (dto.shippingMethodId) {
      const method = await this.prisma.shippingMethod.findUnique({
        where: { id: dto.shippingMethodId },
      });
      if (!method) throw new NotFoundException('Shipping method not found.');
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        ...(dto.shippingRegionId !== undefined
          ? { shippingRegionId: dto.shippingRegionId }
          : {}),
        ...(dto.shippingMethodId !== undefined
          ? { shippingMethodId: dto.shippingMethodId }
          : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      },
    });
    // Audit via the shared service in the M7 audit pass (TODO).
    void userId; void order;
    return this.get(orderId);
  }

  async copyOrder(orderId: string, userId: string): Promise<OrderDetail> {
    const original = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { lines: true },
    });
    if (!original) throw new NotFoundException('Order not found.');

    // M7: copies are numbered `<root>-001`, `-002`, ... (root = the source
    // number without an existing copy suffix, so copying a copy still
    // increments the original's sequence).
    const copyNumber = await this.nextCopyNumber(original.displayNumber);
    const copy = await this.createManual(
      {
        lines: original.lines.map((line) => ({
          title: line.title ?? '',
          ...(line.description ? { description: line.description } : {}),
          quantity: line.quantity,
          ...(line.itemVariantId ? { itemVariantId: line.itemVariantId } : {}),
        })),
        customer: original.customerSnapshot as CreateManualOrderDto['customer'],
        buyerNote: original.buyerNote ?? undefined,
      },
      userId,
      copyNumber,
    );

    await this.prisma.orderLink.create({
      data: { orderId, relatedOrderId: copy.id, createdBy: userId },
    });
    await this.prisma.note.create({
      data: {
        ownerType: 'order',
        ownerId: copy.id,
        orderOwnerId: copy.id,
        body: `[Copy] Duplicated from ${original.displayNumber} (re-ship flow)`,
        createdBy: userId,
      },
    });
    return copy;
  }

  /**
   * Resolves the next `<root>-NNN` copy number. The root strips an existing
   * 3+ digit copy suffix so re-copying a copy keeps incrementing the
   * original sequence.
   */
  private async nextCopyNumber(sourceDisplayNumber: string): Promise<string> {
    const root = sourceDisplayNumber.replace(/-\d{3,}$/, '');
    const siblings = await this.prisma.order.findMany({
      where: { displayNumber: { startsWith: `${root}-` } },
      select: { displayNumber: true },
    });
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}-(\\d{3,})$`);
    let max = 0;
    for (const sibling of siblings) {
      const match = pattern.exec(sibling.displayNumber);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `${root}-${String(max + 1).padStart(3, '0')}`;
  }

  /** Manual local cancellation (all platforms; platform auto-sync is deferred). */
  async cancelOrder(
    orderId: string,
    userId: string,
    reason?: string,
  ): Promise<OrderDetail> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.cancelledAt) {
      throw new ConflictException('Order is already cancelled.');
    }
    const platformCancelledAt = (order.statusRaw as { cancelledAt?: unknown } | null)
      ?.cancelledAt;
    if (platformCancelledAt) {
      throw new ConflictException('Order is already cancelled on the platform.');
    }

    const now = new Date();
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        cancelledAt: now,
        cancelledBy: userId,
        cancelledReason: reason?.trim() || null,
        stage: 'cancelled',
        stageUpdatedAt: now,
        stageUpdatedBy: userId,
        version: { increment: 1 },
      },
    });
    await this.prisma.shipment.updateMany({
      where: { orderId, voidedAt: null },
      data: { voidedAt: now, voidedBy: userId, voidReason: 'order cancelled' },
    });
    await this.prisma.orderStageEvent.create({
      data: {
        orderId,
        fromStage: order.stage,
        toStage: 'cancelled',
        action: 'cancelled',
        actorId: userId,
        note: reason?.trim() || null,
      },
    });
    // Return previously deducted stock (packing already deducted).
    if (order.stockDeductedAt) {
      await this.inventory.returnForOrder(orderId, userId, 'order cancelled');
    }
    // A cancelled order must not linger in the unfulfilled-order queue.
    await this.prisma.reviewRecord.updateMany({
      where: { type: 'new_order', subjectId: orderId, status: 'pending' },
      data: { status: 'cancelled', decidedBy: userId, decidedAt: new Date() },
    });
    await this.audit.record({
      actorId: userId,
      action: 'order.cancelled',
      objectType: 'Order',
      objectId: orderId,
      before: { cancelledAt: null },
      after: {
        cancelledAt: updated.cancelledAt,
        reason: updated.cancelledReason,
      },
    });
    return this.get(orderId);
  }

  async createManual(
    dto: CreateManualOrderDto,
    userId: string,
    displayNumber?: string,
  ): Promise<OrderDetail> {
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
              displayNumber: displayNumber ?? generateOrderNumber(),
              stage: 'review',
              stageUpdatedAt: new Date(),
              paymentStatus: 'PAID',
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
    await this.prisma.orderStageEvent.create({
      data: {
        orderId: order.id,
        fromStage: null,
        toStage: 'review',
        action: 'created',
        actorId: userId,
      },
    });

    // Manual orders (including copies) are unfulfilled and therefore enter
    // the unfulfilled-order review queue for region/category assignment.
    // Approval only confirms the existing order (see ReviewService).
    await this.prisma.reviewRecord.create({
      data: {
        type: 'new_order',
        status: 'pending',
        storeId: null,
        subjectId: order.id,
        payload: {
          existingOrder: true,
          order: {
            externalOrderId: null,
            displayNumber: order.displayNumber,
            statusRaw: {},
            customer: order.customerSnapshot ?? {},
            buyerNote: order.buyerNote ?? null,
            deliveryMethod: order.deliveryMethod ?? null,
            sourceUpdatedAt: order.createdAt.toISOString(),
            lines: order.lines.map((line) => ({
              externalLineId: line.id,
              title: line.title ?? '',
              quantity: line.quantity,
              listingExternalId: '',
              variantExternalId: line.itemVariantId ?? '',
            })),
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return this.get(order.id);
  }

  async list(query: ListOrdersQueryDto) {
    const search = query.search?.trim();
    // Operational status filter. Partial fulfillment counts as unfulfilled
    // (remaining items still need processing); platform fulfilment is read
    // from the preserved raw status.
    const stageGroupFilter: Prisma.OrderWhereInput | null =
      query.stageGroup === 'active'
        ? {
            stage: {
              in: ['review', 'awaiting_payment', 'packing', 'ordering', 'inspection', 'problem'],
            },
          }
        : query.stageGroup === 'finished'
          ? { stage: { in: ['completed', 'cancelled'] } }
          : null;
    const statusFilter: Prisma.OrderWhereInput | null =
      query.status === 'cancelled'
        ? { cancelledAt: { not: null } }
        : query.status === 'fulfilled'
          ? { cancelledAt: null, fulfillmentStatus: 'FULFILLED' }
          : query.status === 'unfulfilled'
            ? {
                cancelledAt: null,
                OR: [
                  { fulfillmentStatus: null },
                  { fulfillmentStatus: { not: 'FULFILLED' } },
                ],
              }
            : null;
    const where: Prisma.OrderWhereInput = {
      ...(query.source ? { source: query.source } : {}),
      ...(query.storeId ? { storeId: query.storeId } : {}),
      ...(query.shippingRegionId
        ? { shippingRegionId: query.shippingRegionId }
        : {}),
      ...(query.shippingMethodId
        ? { shippingMethodId: query.shippingMethodId }
        : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...((() => {
        const filters = [statusFilter, stageGroupFilter].filter(
          (filter): filter is Prisma.OrderWhereInput => Boolean(filter),
        );
        return filters.length > 0 ? { AND: filters } : {};
      })()),
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
          shippingRegion: { select: { id: true, name: true } },
          shippingMethod: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          // Latest reviewer note for the list column (M7 follow-up).
          notes: {
            where: { body: { startsWith: '[Review] ' } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, createdAt: true },
          },
          shipments: {
            orderBy: { enteredAt: 'desc' },
            take: 1,
            select: {
              attakyTrackingNumber: true,
              originalTrackingNumber: true,
              tailTrackingNumber: true,
              carrier: { select: { name: true } },
              dispatchedAt: true,
            },
          },
          lines: { take: 1, orderBy: { createdAt: 'asc' }, select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page! - 1) * query.pageSize!,
        take: query.pageSize!,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      orders: orders.map(({ notes, ...order }) => ({
        ...order,
        latestReviewNote: notes[0]?.body ?? null,
      })),
      total,
      page: query.page!,
      pageSize: query.pageSize!,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize!)),
    };
  }

  async get(id: string): Promise<OrderDetail> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        ...orderDetailInclude,
        lines: {
          orderBy: { createdAt: 'asc' },
          include: {
            ...orderLineInclude,
            itemVariant: { select: { id: true, itemCode: true, name: true, images: true, item: { select: { images: true } } } },
            listingVariant: { select: { id: true, externalSku: true, externalVariantId: true, listing: { select: { currentVersion: { select: { snapshot: true } } } } } },
            itemContentVersion: { select: { id: true, effectiveAt: true, snapshot: true } },
            listingContentVersion: { select: { id: true, effectiveAt: true, snapshot: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');

    // Resolve actor display names for the workflow history and problem items.
    const actorIds = new Set<string>();
    for (const event of order.stageEvents) {
      if (event.actorId !== 'system') actorIds.add(event.actorId);
    }
    for (const problem of order.problemItems) {
      actorIds.add(problem.reportedBy);
      if (problem.handledBy) actorIds.add(problem.handledBy);
    }
    const users = actorIds.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...actorIds] } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((user) => [user.id, user.name]));

    return {
      ...order,
      lines: order.lines.map((line) => ({
        ...line,
        ...orderDetailLineImages(line),
        listingVariant: line.listingVariant ? { id: line.listingVariant.id, externalSku: line.listingVariant.externalSku } : null,
        itemContentVersion: line.itemContentVersion ? { id: line.itemContentVersion.id, effectiveAt: line.itemContentVersion.effectiveAt } : null,
        listingContentVersion: line.listingContentVersion ? { id: line.listingContentVersion.id, effectiveAt: line.listingContentVersion.effectiveAt } : null,
      })),
      stageEvents: order.stageEvents.map((event) => ({
        ...event,
        actorName:
          event.actorId === 'system' ? null : names.get(event.actorId) ?? null,
      })),
      problemItems: order.problemItems.map((problem) => ({
        ...problem,
        reportedByName: names.get(problem.reportedBy) ?? null,
        handledByName: problem.handledBy
          ? names.get(problem.handledBy) ?? null
          : null,
      })),
    };
  }

  /** Edits the ordered product lines while the order is in unfulfilled review. */
  async reviewItems(
    orderId: string,
    dto: { lines: Array<{ id?: string; title: string; quantity: number }> },
    userId: string,
  ): Promise<OrderDetail> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.stage !== 'review') {
      throw new ConflictException('Order items can only be edited during review.');
    }
    if (dto.lines.length === 0) {
      throw new BadRequestException('An order needs at least one product line.');
    }

    const existing = new Map(order.lines.map((line) => [line.id, line]));
    for (const line of dto.lines) {
      if (line.id && !existing.has(line.id)) {
        throw new BadRequestException('Unknown order line.');
      }
    }
    const keepIds = new Set(
      dto.lines.map((line) => line.id).filter((id): id is string => Boolean(id)),
    );
    const before = order.lines.map((line) => ({
      id: line.id,
      title: line.title,
      quantity: line.quantity,
    }));

    await this.prisma.$transaction(async (tx) => {
      for (const line of dto.lines) {
        const title = line.title.trim();
        if (line.id) {
          await tx.orderLine.update({
            where: { id: line.id },
            data: { title, quantity: line.quantity },
          });
        } else {
          await tx.orderLine.create({
            data: { orderId, title, quantity: line.quantity },
          });
        }
      }
      const deleteIds = order.lines
        .filter((line) => !keepIds.has(line.id))
        .map((line) => line.id);
      if (deleteIds.length > 0) {
        await tx.orderLine.deleteMany({ where: { id: { in: deleteIds } } });
      }
    });

    const after = await this.prisma.orderLine.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, quantity: true },
    });
    await this.prisma.orderRevision.create({
      data: {
        orderId,
        reason: 'Order items edited during review',
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
        userId,
      },
    });
    await this.prisma.orderStageEvent.create({
      data: {
        orderId,
        fromStage: 'review',
        toStage: 'review',
        action: 'items_edited',
        actorId: userId,
        metadata: { lines: after.length },
      },
    });

    const records = await this.prisma.reviewRecord.findMany({
      where: { type: 'new_order', subjectId: orderId, status: 'pending' },
    });
    for (const record of records) {
      const payload = (record.payload ?? {}) as { order?: Record<string, unknown> };
      if (payload.order) {
        await this.prisma.reviewRecord.update({
          where: { id: record.id },
          data: {
            payload: {
              ...payload,
              order: {
                ...payload.order,
                lines: after.map((line) => ({
                  title: line.title ?? '',
                  quantity: line.quantity,
                })),
              },
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    await this.audit.record({
      actorId: userId,
      action: 'order.items_edited_in_review',
      objectType: 'Order',
      objectId: orderId,
      before: before as Prisma.InputJsonValue,
      after: after as Prisma.InputJsonValue,
    });
    return this.get(orderId);
  }

  /** Edits the customer snapshot while the order is in unfulfilled review. */
  async reviewCustomer(
    orderId: string,
    dto: {
      name?: string;
      phone?: string;
      email?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      postalCode?: string;
      country?: string;
    },
    userId: string,
  ): Promise<OrderDetail> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.stage !== 'review') {
      throw new ConflictException('Customer info can only be edited during review.');
    }

    const before = (order.customerSnapshot ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) patch[key] = value.trim();
    }
    const after = { ...before, ...patch };

    await this.prisma.order.update({
      where: { id: orderId },
      data: { customerSnapshot: after as Prisma.InputJsonValue },
    });
    await this.prisma.orderRevision.create({
      data: {
        orderId,
        reason: 'Customer info edited during review',
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
        userId,
      },
    });
    await this.prisma.orderStageEvent.create({
      data: {
        orderId,
        fromStage: 'review',
        toStage: 'review',
        action: 'customer_edited',
        actorId: userId,
        metadata: { fields: Object.keys(patch) },
      },
    });

    // Keep the pending review payload in sync so the review card shows the
    // updated customer without a stale snapshot.
    const records = await this.prisma.reviewRecord.findMany({
      where: { type: 'new_order', subjectId: orderId, status: 'pending' },
    });
    for (const record of records) {
      const payload = (record.payload ?? {}) as { order?: Record<string, unknown> };
      if (payload.order) {
        await this.prisma.reviewRecord.update({
          where: { id: record.id },
          data: {
            payload: {
              ...payload,
              order: { ...payload.order, customer: after },
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    await this.audit.record({
      actorId: userId,
      action: 'order.customer_edited_in_review',
      objectType: 'Order',
      objectId: orderId,
      before: before as Prisma.InputJsonValue,
      after: after as Prisma.InputJsonValue,
    });
    return this.get(orderId);
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
    await this.prisma.reviewRecord.updateMany({
      where: { type: 'new_order', subjectId: id, status: 'pending' },
      data: { status: 'cancelled', decidedBy: userId, decidedAt: new Date() },
    });
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
