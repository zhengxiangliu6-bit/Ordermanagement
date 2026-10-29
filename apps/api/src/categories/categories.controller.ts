import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export class CategoryDto {
  @ApiProperty({ minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional({ description: 'Tracking-site template with {number} placeholder (R8).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  trackingUrlTemplate?: string | null;

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
 * Product category management (M7 R1/R3): the second-level order
 * classification with an optional per-category tracking-site template.
 */
@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('categories:read')
  @ApiOperation({ summary: 'List categories (enabled first, then sortOrder).' })
  list() {
    return this.prisma.category.findMany({
      orderBy: [{ enabled: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  @Post()
  @RequirePermissions('categories:manage')
  @ApiOperation({ summary: 'Create a category.' })
  async create(@Body() dto: CategoryDto, @CurrentUser() user: AuthUser) {
    const category = await this.prisma.category.create({
      data: {
        name: dto.name.trim(),
        trackingUrlTemplate: dto.trackingUrlTemplate?.trim() || null,
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'category.created',
      objectType: 'Category',
      objectId: category.id,
      after: { name: category.name },
    });
    return category;
  }

  @Patch(':id')
  @RequirePermissions('categories:manage')
  @ApiOperation({ summary: 'Update a category.' })
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CategoryDto>,
    @CurrentUser() user: AuthUser,
  ) {
    const before = await this.prisma.category.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Category not found.');
    const category = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.trackingUrlTemplate !== undefined
          ? { trackingUrlTemplate: dto.trackingUrlTemplate?.trim() || null }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'category.updated',
      objectType: 'Category',
      objectId: id,
      before: { name: before.name, enabled: before.enabled },
      after: { name: category.name, enabled: category.enabled },
    });
    return category;
  }

  @Delete(':id')
  @RequirePermissions('categories:manage')
  @ApiOperation({
    summary: 'Delete a category; orders referencing it keep their historical display via SET NULL.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.category.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Category not found.');
    const orderCount = await this.prisma.order.count({ where: { categoryId: id } });
    if (orderCount > 0) {
      // Historical orders reference it: refuse, disable instead.
      await this.prisma.category.update({ where: { id }, data: { enabled: false } });
      await this.audit.record({
        actorId: user.id,
        action: 'category.updated',
        objectType: 'Category',
        objectId: id,
        before: { enabled: true },
        after: { enabled: false, note: `disabled instead of delete (${orderCount} orders reference it)` },
      });
      return { ok: true, disabled: true, orderCount };
    }
    await this.prisma.category.delete({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: 'category.deleted',
      objectType: 'Category',
      objectId: id,
      before: { name: before.name },
    });
    return { ok: true, disabled: false };
  }
}
