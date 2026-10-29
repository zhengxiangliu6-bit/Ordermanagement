import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequireAnyPermissions } from '../rbac/require-permissions.decorator';
import { ItemsService } from './items.service';

class SearchVariantsQueryDto {
  @ApiPropertyOptional({ enum: ['china', 'canada'] })
  @IsOptional()
  @IsIn(['china', 'canada'])
  warehouse?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

@ApiTags('items')
@Controller('item-variants')
export class ItemVariantsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequireAnyPermissions('items:read', 'mapping:read', 'orders:review', 'orders:create-manual', 'shipping:weigh')
  @ApiOperation({
    summary: 'Search active item variants (for pickers); matches code, name, and item name.',
  })
  search(@Query() query: SearchVariantsQueryDto) {
    return this.items.searchVariants(query.search, query.warehouse);
  }
}
