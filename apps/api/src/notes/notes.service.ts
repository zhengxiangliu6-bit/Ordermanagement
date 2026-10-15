import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hasAnyPermission } from '@om/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Owner types that support Notes (functional design §16.1). */
export const NOTE_OWNER_TYPES = [
  'item',
  'item_variant',
  'listing',
  'listing_variant',
  'order',
  'order_line',
] as const;

export type NoteOwnerType = (typeof NOTE_OWNER_TYPES)[number];

export function assertNoteOwnerType(ownerType: string): asserts ownerType is NoteOwnerType {
  if (!NOTE_OWNER_TYPES.includes(ownerType as NoteOwnerType)) {
    throw new NotFoundException(`Unknown note owner type: ${ownerType}`);
  }
}

export interface AuthPrincipal {
  id: string;
  permissions: string[];
}

/**
 * Each owner type also populates its relational FK column so relation-based
 * reads (e.g. item detail → notes) and scalar-based reads stay consistent.
 */
const OWNER_RELATIONS: Record<
  NoteOwnerType,
  { model: 'item' | 'itemVariant' | 'listing' | 'listingVariant' | 'order' | 'orderLine'; field: string }
> = {
  item: { model: 'item', field: 'itemOwnerId' },
  item_variant: { model: 'itemVariant', field: 'itemVariantOwnerId' },
  listing: { model: 'listing', field: 'listingOwnerId' },
  listing_variant: { model: 'listingVariant', field: 'listingVariantOwnerId' },
  order: { model: 'order', field: 'orderOwnerId' },
  order_line: { model: 'orderLine', field: 'orderLineOwnerId' },
};

const noteAuthorInclude = {
  createdByUser: { select: { id: true, name: true } },
  updatedByUser: { select: { id: true, name: true } },
} satisfies Prisma.NoteInclude;

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(ownerType: NoteOwnerType, ownerId: string) {
    return this.prisma.note.findMany({
      where: { ownerType, ownerId },
      orderBy: { createdAt: 'desc' },
      include: {
        revisions: { orderBy: { editedAt: 'desc' } },
        ...noteAuthorInclude,
      },
    });
  }

  async create(
    ownerType: NoteOwnerType,
    ownerId: string,
    body: string,
    userId: string,
  ) {
    const relation = OWNER_RELATIONS[ownerType];
    const delegate = this.prisma[relation.model] as unknown as {
      findUnique: (args: { where: { id: string } }) => Promise<{ id: string } | null>;
    };
    const owner = await delegate.findUnique({ where: { id: ownerId } });
    if (!owner) throw new NotFoundException('Note owner not found.');

    const note = await this.prisma.note.create({
      data: {
        ownerType,
        ownerId,
        body,
        createdBy: userId,
        [relation.field]: ownerId,
      },
    });
    await this.audit.record({
      actorId: userId,
      action: 'note.created',
      objectType: 'Note',
      objectId: note.id,
      after: { ownerType, ownerId },
    });
    return note;
  }

  async update(noteId: string, body: string, user: AuthPrincipal) {
    const note = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Note not found.');

    const canEditAll = hasAnyPermission(user.permissions, ['notes:edit-all']);
    const canEditOwn =
      hasAnyPermission(user.permissions, ['notes:edit-own']) &&
      note.createdBy === user.id;
    if (!canEditAll && !canEditOwn) {
      throw new ForbiddenException('Insufficient permissions.');
    }

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: { body, updatedBy: user.id },
    });
    await this.prisma.noteRevision.create({
      data: { noteId, previousBody: note.body, editedBy: user.id },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'note.updated',
      objectType: 'Note',
      objectId: noteId,
      before: { body: note.body },
      after: { body },
    });
    return updated;
  }

  async remove(noteId: string, userId: string): Promise<void> {
    const note = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Note not found.');
    await this.prisma.note.delete({ where: { id: noteId } });
    await this.audit.record({
      actorId: userId,
      action: 'note.deleted',
      objectType: 'Note',
      objectId: noteId,
      before: { body: note.body, ownerType: note.ownerType, ownerId: note.ownerId },
    });
  }
}
