import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ShipmentService } from './shipment.service';

export class ListShipmentsQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'scheduled', 'needs_attention'] })
  @IsOptional()
  @IsIn(['all', 'scheduled', 'needs_attention'])
  view?: 'all' | 'scheduled' | 'needs_attention';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

}

@ApiTags('shipments')
@Controller('shipments')
export class ShipmentListController {
  constructor(private readonly shipments: ShipmentService) {}

  @Get()
  @RequirePermissions('shipping:read')
  @ApiOperation({
    summary: 'Shipments list views (§24): all / scheduled / needs attention.',
  })
  list(@Query() query: ListShipmentsQueryDto, @CurrentUser() user: AuthUser) {
    return this.shipments.listViews(
      query.view ?? 'all',
      query.storeId,
      query.page ?? 1,
      query.pageSize ?? 50,
      user.permissions,
    );
  }
}
