import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  assertQueueType,
  ReviewService,
} from './review.service';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../rbac/require-permissions.decorator';

export class ReviewListQueryDto {
  @ApiPropertyOptional({ enum: ['new_order', 'order_update', 'listing', 'shipment'] })
  @IsOptional()
  @IsIn(['new_order', 'order_update', 'listing', 'shipment'])
  type?: string;

  @IsOptional()
  @IsString()
  storeId?: string;
}

export class ApproveBatchDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

@ApiTags('review')
@Controller('review-queue')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get()
  @RequirePermissions('orders:review')
  @ApiOperation({ summary: 'List pending review records (filter by type/store).' })
  list(
    @Query('type') type: string,
    @Query('storeId') storeId: string | undefined,
    @Query('conflict') conflict: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    assertQueueType(type);
    const conflictFilter =
      conflict === 'true' ? true : conflict === 'false' ? false : undefined;
    return this.review.list(type, storeId, 1, 50, conflictFilter, user.permissions);
  }

  @Get(':id')
  @RequirePermissions('orders:review')
  @ApiOperation({ summary: 'Get one review record.' })
  getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.review.get(id, user.permissions);
  }

  @Patch(':id/note')
  @RequireAnyPermissions('orders:review')
  @ApiOperation({ summary: 'Save a reviewer note on a pending record (M7).' })
  saveNote(
    @Param('id') id: string,
    @Body() dto: { note?: string },
  ) {
    return this.review.saveNote(id, dto.note ?? null);
  }

  @Post(':id/approve')
  @RequireAnyPermissions('orders:review', 'shipping:review')
  @ApiOperation({ summary: 'Approve one pending record (per-type permission asserted in service).' })
  approve(
    @Param('id') id: string,
    @Body() dto: { shippingRegionId?: string; categoryId?: string | null; note?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.review.approve(id, user.id, user.permissions, dto);
  }

  @Post('approve-batch')
  @RequireAnyPermissions('orders:review', 'shipping:review')
  @ApiOperation({ summary: 'Approve many pending records (per-record errors listed).' })
  approveBatch(
    @Body() dto: ApproveBatchDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.review.approveBatch(dto.ids, user.id, user.permissions);
  }

  @Post(':id/reject')
  @RequireAnyPermissions('orders:review', 'shipping:review')
  @ApiOperation({ summary: 'Reject a pending record (kept, not re-queued for the same revision).' })
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.review.reject(id, user.id, user.permissions);
  }
}
