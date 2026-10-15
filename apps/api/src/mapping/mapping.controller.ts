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
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
