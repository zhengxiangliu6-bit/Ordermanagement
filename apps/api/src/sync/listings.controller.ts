import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';

class ListListingsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  storeId?: string;
}

@ApiTags('listings')
@Controller('listings')
export class ListingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('listings:read')
  @ApiOperation({ summary: 'Read-only listing mirror across stores.' })
  async list(@Query() query: ListListingsQueryDto) {
    const listings = await this.prisma.listing.findMany({
      where: { ...(query.storeId ? { storeId: query.storeId } : {}) },
      orderBy: { updatedAt: 'desc' },
      include: {
        store: { select: { displayName: true, platform: true } },
        _count: { select: { variants: true, notes: true } },
        currentVersion: { select: { snapshot: true, effectiveAt: true } },
      },
    });
    return listings.map((listing) => {
      const snapshot = (listing.currentVersion?.snapshot ?? {}) as {
        title?: string;
        variants?: Array<{ externalVariantId: string; externalSku?: string }>;
      };
      return {
        id: listing.id,
        storeId: listing.storeId,
        storeName: listing.store?.displayName ?? null,
        platform: listing.store?.platform ?? null,
        externalListingId: listing.externalListingId,
        status: listing.status,
        title: snapshot.title ?? listing.externalListingId,
        skuCount: snapshot.variants?.length ?? listing._count.variants,
        noteCount: listing._count.notes,
        lastSourceUpdateAt: listing.lastSourceUpdateAt,
        createdAt: listing.createdAt,
      };
    });
  }
}
