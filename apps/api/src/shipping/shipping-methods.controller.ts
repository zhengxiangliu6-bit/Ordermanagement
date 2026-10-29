import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export class ShippingMethodDto {
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

/**
 * Configurable shipping methods (M7 follow-up): replaces the hard-coded
 * china/canada region at unfulfilled-order review. Readable by order
 * viewers; maintained by shipping-settings editors.
 */
@ApiTags('shipping-methods')
@Controller('shipping-methods')
export class ShippingMethodsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'List shipping methods (enabled first, then sortOrder).' })
  list() {
    return this.prisma.shippingMethod.findMany({
      orderBy: [{ enabled: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  @Post()
  @RequirePermissions('shipping:manage-settings')
  @ApiOperation({ summary: 'Create a shipping method.' })
  async create(@Body() dto: ShippingMethodDto, @CurrentUser() user: AuthUser) {
    const method = await this.prisma.shippingMethod.create({
      data: {
        name: dto.name.trim(),
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'shipping_method.created',
      objectType: 'ShippingMethod',
      objectId: method.id,
      after: { name: method.name },
    });
    return method;
  }

  @Patch(':id')
  @RequirePermissions('shipping:manage-settings')
  @ApiOperation({ summary: 'Update a shipping method.' })
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<ShippingMethodDto>,
    @CurrentUser() user: AuthUser,
  ) {
    const before = await this.prisma.shippingMethod.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Shipping method not found.');
    const method = await this.prisma.shippingMethod.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'shipping_method.updated',
      objectType: 'ShippingMethod',
      objectId: id,
      before: { name: before.name, enabled: before.enabled },
      after: { name: method.name, enabled: method.enabled },
    });
    return method;
  }

  @Delete(':id')
  @RequirePermissions('shipping:manage-settings')
  @ApiOperation({
    summary: 'Delete a shipping method; orders referencing it keep history (SET NULL).',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.shippingMethod.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Shipping method not found.');
    const orderCount = await this.prisma.order.count({
      where: { shippingMethodId: id },
    });
    if (orderCount > 0) {
      // Historical orders reference it: refuse, disable instead.
      await this.prisma.shippingMethod.update({
        where: { id },
        data: { enabled: false },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'shipping_method.updated',
        objectType: 'ShippingMethod',
        objectId: id,
        before: { enabled: true },
        after: {
          enabled: false,
          note: `disabled instead of delete (${orderCount} orders reference it)`,
        },
      });
      return { ok: true, disabled: true, orderCount };
    }
    await this.prisma.shippingMethod.delete({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: 'shipping_method.deleted',
      objectType: 'ShippingMethod',
      objectId: id,
      before: { name: before.name },
    });
    return { ok: true, disabled: false };
  }
}
