import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  /** Authenticated user id; omit for system actions. */
  actorId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

/**
 * Append-only audit recorder (functional design §23). Every entry records
 * the actor, action, affected object, and the before/after detail needed to
 * understand the event. Entries are never updated or deleted.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorType: entry.actorId ? 'user' : 'system',
        actorId: entry.actorId,
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId,
        before: (entry.before ?? undefined) as Prisma.InputJsonValue,
        after: (entry.after ?? undefined) as Prisma.InputJsonValue,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  /** Paginated, filtered audit listing (permission: audit:read). */
  async list(query: {
    objectType?: string;
    action?: string;
    actorId?: string;
    dateFrom?: string;
    dateTo?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.AuditEventWhereInput = {
      ...(query.objectType ? { objectType: query.objectType } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };
    const [events, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return {
      events,
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }
}
