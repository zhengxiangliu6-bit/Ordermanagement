import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  ConflictException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireAnyPermissions, RequirePermissions } from '../rbac/require-permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export class ShippingRegionDto {
  @ApiProperty({ enum: ['china', 'canada'], description: 'Warehouse stock is deducted from.' })
  @IsIn(['china', 'canada'])
  warehouse!: string;

  @ApiProperty({ minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateShippingRegionDto extends PartialType(ShippingRegionDto) {}

/** Configurable shipping regions used at unfulfilled-order review (M7b). */
@ApiTags('shipping-regions')
@Controller('shipping-regions')
export class ShippingRegionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequireAnyPermissions('orders:read', 'shipping:issue-review')
  @ApiOperation({ summary: 'List shipping regions (enabled first, then sortOrder).' })
  list() {
    return this.prisma.shippingRegion.findMany({
      orderBy: [{ enabled: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  @Post()
  @RequirePermissions('shipping:manage-settings')
  @ApiOperation({ summary: 'Create a shipping region.' })
  async create(@Body() dto: ShippingRegionDto, @CurrentUser() user: AuthUser) {
    const region = await this.prisma.shippingRegion.create({
      data: {
        name: dto.name.trim(),
        enabled: dto.enabled ?? true,
        warehouse: dto.warehouse ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'shipping_region.created',
      objectType: 'ShippingRegion',
      objectId: region.id,
      after: { name: region.name },
    });
    return region;
  }

  @Patch(':id')
  @RequirePermissions('shipping:manage-settings')
  @ApiOperation({ summary: 'Update a shipping region.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateShippingRegionDto,
    @CurrentUser() user: AuthUser,
  ) {
    const before = await this.prisma.shippingRegion.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Shipping region not found.');
    if (dto.warehouse && before.warehouse && before.warehouse !== dto.warehouse && await this.prisma.order.count({ where: { shippingRegionId: id } })) {
      throw new ConflictException('This region is already used by orders; create a new region instead of changing its warehouse.');
    }
    const region = await this.prisma.shippingRegion.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.warehouse !== undefined ? { warehouse: dto.warehouse } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'shipping_region.updated',
      objectType: 'ShippingRegion',
      objectId: id,
      before: { name: before.name, enabled: before.enabled },
      after: { name: region.name, enabled: region.enabled },
    });
    return region;
  }

  @Delete(':id')
  @RequirePermissions('shipping:manage-settings')
  @ApiOperation({
    summary: 'Delete a shipping region; orders referencing it keep history (SET NULL).',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.shippingRegion.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Shipping region not found.');
    const orderCount = await this.prisma.order.count({
      where: { shippingRegionId: id },
    });
    if (orderCount > 0) {
      await this.prisma.shippingRegion.update({
        where: { id },
        data: { enabled: false },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'shipping_region.updated',
        objectType: 'ShippingRegion',
        objectId: id,
        before: { enabled: true },
        after: {
          enabled: false,
          note: `disabled instead of delete (${orderCount} orders reference it)`,
        },
      });
      return { ok: true, disabled: true, orderCount };
    }
    await this.prisma.shippingRegion.delete({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: 'shipping_region.deleted',
      objectType: 'ShippingRegion',
      objectId: id,
      before: { name: before.name },
    });
    return { ok: true, disabled: false };
  }
}
