import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { MappingService } from './mapping.service';

export class MappingResolveDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  listingVariantId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  itemVariantId!: string;
}

export class MappingQueueQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  storeId?: string;
}

export class MappingAutoCreateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  storeId?: string;

  @ApiPropertyOptional({ description: 'Preview the plan without writing.' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

@ApiTags('mapping')
@Controller('mapping')
export class MappingController {
  constructor(private readonly mapping: MappingService) {}

  @Get('queue')
  @RequirePermissions('mapping:read')
  @ApiOperation({ summary: 'Unmapped listing variants with affected order-line counts.' })
  queue(@Query() query: MappingQueueQueryDto) {
    return this.mapping.queue(query.storeId);
  }

  @Get('mapped')
  @RequirePermissions('mapping:read')
  @ApiOperation({ summary: 'Currently mapped listing variants with their item targets.' })
  mapped(@Query() query: MappingQueueQueryDto) {
    return this.mapping.mapped(query.storeId);
  }

  @Post('auto-create')
  @RequirePermissions('mapping:manage')
  @ApiOperation({
    summary:
      'Generate internal items+variants from unmapped listings and map them; dryRun previews.',
  })
  autoCreate(@Body() dto: MappingAutoCreateDto, @CurrentUser() user: AuthUser) {
    return this.mapping.autoCreate(dto.storeId, user.id, dto.dryRun === true);
  }

  @Post('resolve')
  @RequirePermissions('mapping:manage')
  @ApiOperation({ summary: 'Map a listing variant to an item variant and backfill unresolved lines.' })
  resolve(
    @Body() dto: MappingResolveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mapping.resolve(dto.listingVariantId, dto.itemVariantId, user.id);
  }

  @Delete(':listingVariantId')
  @RequirePermissions('mapping:manage')
  @ApiOperation({ summary: 'Remove the mapping of a listing variant.' })
  unbind(
    @Param('listingVariantId') listingVariantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mapping.unbind(listingVariantId, user.id);
  }
}
