import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { RequireAnyPermissions } from '../rbac/require-permissions.decorator';
import { ItemsService } from './items.service';

class SearchVariantsQueryDto {
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
  @RequireAnyPermissions('items:read', 'mapping:read', 'orders:review', 'shipping:weigh')
  @ApiOperation({
    summary: 'Search active item variants (for pickers); matches code, name, and item name.',
  })
  search(@Query() query: SearchVariantsQueryDto) {
    return this.items.searchVariants(query.search);
  }
}
