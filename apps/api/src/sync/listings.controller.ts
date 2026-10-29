import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';

class ListListingsQueryDto {
  @ApiPropertyOptional({ description: 'Filter listings by store.' })
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

  @Get(':id')
  @RequirePermissions('listings:read')
  @ApiOperation({ summary: 'One listing with its variant details (verification view).' })
  async getOne(@Param('id') id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        store: { select: { displayName: true, platform: true } },
        currentVersion: { select: { snapshot: true, effectiveAt: true } },
        variants: {
          orderBy: { externalVariantId: 'asc' },
          select: {
            id: true,
            externalVariantId: true,
            externalTitle: true,
            externalSku: true,
            optionValues: true,
          },
        },
      },
    });
    if (!listing) throw new NotFoundException('Listing not found.');
    const snapshot = (listing.currentVersion?.snapshot ?? {}) as {
      title?: string;
      description?: string | null;
    };
    return {
      id: listing.id,
      storeName: listing.store?.displayName ?? null,
      platform: listing.store?.platform ?? null,
      externalListingId: listing.externalListingId,
      status: listing.status,
      title: snapshot.title ?? listing.externalListingId,
      description: snapshot.description ?? null,
      lastSourceUpdateAt: listing.lastSourceUpdateAt,
      variants: listing.variants,
    };
  }
}
