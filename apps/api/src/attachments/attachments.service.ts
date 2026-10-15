import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { STORAGE_DRIVER } from '../storage/storage.types';
import type { StorageDriver } from '../storage/storage.types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Owner types that support attachments (§16.4). */
export const ATTACHMENT_OWNER_TYPES = ['order', 'order_line', 'item_variant'] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];

const OWNER_MODELS = {
  order: 'order',
  order_line: 'orderLine',
  item_variant: 'itemVariant',
} as const satisfies Record<AttachmentOwnerType, string>;

export function assertAttachmentOwnerType(
  ownerType: string,
): asserts ownerType is AttachmentOwnerType {
  if (!ATTACHMENT_OWNER_TYPES.includes(ownerType as AttachmentOwnerType)) {
    throw new BadRequestException(`Unsupported attachment owner type: ${ownerType}`);
  }
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    // Token injection: StorageDriver is a type-only import.
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
  ) {}

  list(ownerType: AttachmentOwnerType, ownerId: string) {
    return this.prisma.attachment.findMany({
      where: { ownerType, ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getWithContent(id: string): Promise<{
    attachment: { filename: string; mimeType: string | null };
    content: Buffer;
  }> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    const content = await this.storage.get(attachment.storageKey);
    return { attachment, content };
  }

  async create(
    ownerType: AttachmentOwnerType,
    ownerId: string,
    file: { originalname: string; mimetype?: string; size: number; buffer: Buffer },
    userId: string,
  ) {
    const delegate = this.prisma[OWNER_MODELS[ownerType]] as unknown as {
      findUnique: (args: { where: { id: string } }) => Promise<{ id: string } | null>;
    };
    const owner = await delegate.findUnique({ where: { id: ownerId } });
    if (!owner) throw new NotFoundException('Attachment owner not found.');

    const key = `${ownerType}/${ownerId}/${randomBytes(8).toString('hex')}-${file.originalname}`;
    await this.storage.put(key, file.buffer);
    const attachment = await this.prisma.attachment.create({
      data: {
        ownerType,
        ownerId,
        filename: file.originalname,
        mimeType: file.mimetype ?? null,
        sizeBytes: file.size,
        storageKey: key,
        uploadedBy: userId,
        itemVariantOwnerId: ownerType === 'item_variant' ? ownerId : undefined,
      },
    });
    await this.audit.record({
      actorId: userId,
      action: 'attachment.uploaded',
      objectType: 'Attachment',
      objectId: attachment.id,
      after: { ownerType, ownerId, filename: attachment.filename, sizeBytes: attachment.sizeBytes },
    });
    return attachment;
  }

  async remove(id: string, userId: string): Promise<void> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    await this.storage.delete(attachment.storageKey);
    await this.prisma.attachment.delete({ where: { id } });
    await this.audit.record({
      actorId: userId,
      action: 'attachment.deleted',
      objectType: 'Attachment',
      objectId: id,
      before: { filename: attachment.filename, ownerType: attachment.ownerType },
    });
  }
}
