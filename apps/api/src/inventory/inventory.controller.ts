import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../rbac/require-permissions.decorator';
import {
  InventoryService,
  INVENTORY_MOVEMENT_TYPES,
  INVENTORY_WAREHOUSES,
} from './inventory.service';

class AdjustStockDto {
  @ApiProperty({ enum: INVENTORY_WAREHOUSES })
  @IsIn(INVENTORY_WAREHOUSES)
  warehouse!: (typeof INVENTORY_WAREHOUSES)[number];

  @ApiProperty({ description: 'Signed delta; negative for write-offs.' })
  @Type(() => Number)
  @IsNumber()
  @Min(-100000)
  delta!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class StocktakeDto {
  @ApiProperty({ enum: INVENTORY_WAREHOUSES })
  @IsIn(INVENTORY_WAREHOUSES)
  warehouse!: (typeof INVENTORY_WAREHOUSES)[number];

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedQuantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class ThresholdDto {
  @ApiProperty({ enum: INVENTORY_WAREHOUSES })
  @IsIn(INVENTORY_WAREHOUSES)
  warehouse!: (typeof INVENTORY_WAREHOUSES)[number];

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowThreshold!: number;
}

class WarehouseArchiveDto {
  @ApiProperty({ enum: INVENTORY_WAREHOUSES })
  @IsIn(INVENTORY_WAREHOUSES)
  warehouse!: (typeof INVENTORY_WAREHOUSES)[number];
}

class MovementsQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({ enum: INVENTORY_MOVEMENT_TYPES })
  @IsOptional()
  @IsIn(INVENTORY_MOVEMENT_TYPES as unknown as string[])
  type?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Restrict to one variant of the item.' })
  @IsOptional()
  @IsString()
  variantId?: string;

  @ApiPropertyOptional({ enum: INVENTORY_WAREHOUSES })
  @IsOptional()
  @IsIn(INVENTORY_WAREHOUSES)
  warehouse?: (typeof INVENTORY_WAREHOUSES)[number];
}

/**
 * Inventory management (M7d, consolidated): per-warehouse stock lives on
 * the catalog product variants; item/variant CRUD itself is the items
 * module's job.
 */
@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  /** Reads accept the global key or any warehouse-scoped key. */
  private static readonly READ_ANY = [
    'inventory:read',
    'inventory:china:read',
    'inventory:canada:read',
  ] as const;

  /** Writes accept the global key or any warehouse-scoped key; the target
   * warehouse is validated against the granted key inside the service. */
  private static readonly MANAGE_ANY = [
    'inventory:manage',
    'inventory:china:manage',
    'inventory:canada:manage',
  ] as const;

  constructor(private readonly inventory: InventoryService) {}

  @Get('items')
  @RequireAnyPermissions(...InventoryController.READ_ANY)
  @ApiOperation({ summary: 'List catalog items with variants and stock.' })
  list() {
    return this.inventory.listItems();
  }

  @Get('items/:id/movements')
  @RequireAnyPermissions(...InventoryController.READ_ANY)
  @ApiOperation({ summary: 'Paginated movement history for a catalog item.' })
  movements(@Param('id') id: string, @Query() query: MovementsQueryDto) {
    return this.inventory.itemMovements(id, query);
  }

  @Get('variants/:variantId')
  @RequireAnyPermissions(...InventoryController.READ_ANY)
  @ApiOperation({ summary: 'Stock detail for one product variant.' })
  variantDetail(@Param('variantId') variantId: string) {
    return this.inventory.variantDetail(variantId);
  }

  @Get('variants/:variantId/movements')
  @RequireAnyPermissions(...InventoryController.READ_ANY)
  @ApiOperation({ summary: 'Paginated movement history for one product variant.' })
  variantMovements(
    @Param('variantId') variantId: string,
    @Query() query: MovementsQueryDto,
  ) {
    return this.inventory.variantMovements(variantId, query);
  }

  @Post('variants/:variantId/adjust')
  @RequireAnyPermissions(...InventoryController.MANAGE_ANY)
  @ApiOperation({ summary: 'Apply a signed stock adjustment (inbound / write-off).' })
  adjust(
    @Param('variantId') variantId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventory.adjust(
      variantId,
      dto.warehouse,
      dto.delta,
      user.id,
      dto.note,
      user.permissions,
    );
  }

  @Post('variants/:variantId/archive')
  @RequireAnyPermissions(...InventoryController.MANAGE_ANY)
  @ApiOperation({
    summary: 'Archive a product variant in one warehouse (keeps the other active).',
  })
  archiveVariant(
    @Param('variantId') variantId: string,
    @Body() dto: WarehouseArchiveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventory.setVariantArchivedInWarehouse(
      variantId,
      dto.warehouse,
      true,
      user.id,
      user.permissions,
    );
  }

  @Post('variants/:variantId/restore')
  @RequireAnyPermissions(...InventoryController.MANAGE_ANY)
  @ApiOperation({ summary: 'Restore a warehouse-archived product variant.' })
  restoreVariant(
    @Param('variantId') variantId: string,
    @Body() dto: WarehouseArchiveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventory.setVariantArchivedInWarehouse(
      variantId,
      dto.warehouse,
      false,
      user.id,
      user.permissions,
    );
  }

  @Delete('variants/:variantId/warehouse-stock')
  @RequireAnyPermissions(...InventoryController.MANAGE_ANY)
  @ApiOperation({
    summary: 'Delete one warehouse stock row (direct delete of archived stock).',
  })
  deleteWarehouseStock(
    @Param('variantId') variantId: string,
    @Query() dto: WarehouseArchiveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventory.deleteWarehouseStock(
      variantId,
      dto.warehouse,
      user.id,
      user.permissions,
    );
  }

  @Post('variants/:variantId/stocktake')
  @RequireAnyPermissions(...InventoryController.MANAGE_ANY)
  @ApiOperation({ summary: 'Stocktake: set the counted quantity for a warehouse.' })
  stocktake(
    @Param('variantId') variantId: string,
    @Body() dto: StocktakeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventory.stocktake(
      variantId,
      dto.warehouse,
      dto.countedQuantity,
      user.id,
      dto.note,
      user.permissions,
    );
  }

  @Patch('variants/:variantId/threshold')
  @RequirePermissions('inventory:manage')
  @ApiOperation({ summary: 'Set the low-stock threshold for a warehouse.' })
  setThreshold(
    @Param('variantId') variantId: string,
    @Body() dto: ThresholdDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventory.setThreshold(variantId, dto.warehouse, dto.lowThreshold, user.id);
  }

  @Post('stocktake-batch')
  @RequireAnyPermissions(...InventoryController.MANAGE_ANY)
  @ApiOperation({ summary: 'Batch stocktake with per-entry and batch notes.' })
  stocktakeBatch(
    @Body()
    dto: {
      entries: Array<{
        itemVariantId: string;
        warehouse: string;
        countedQuantity: number;
        note?: string;
      }>;
      note?: string;
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventory.stocktakeBatch(dto.entries, dto.note ?? null, user.id, user.permissions);
  }
}
