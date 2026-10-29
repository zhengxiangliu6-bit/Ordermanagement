import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import {
  CreateAddOnDto,
  InspectShipmentDto,
  PackShipmentDto,
  ShipmentEntryDto,
  TailTrackingDto,
} from './dto/shipping.dto';
import { ShippingWorkService } from './shipping-work.service';

/** M7b three-stage fulfillment workspace. */
@ApiTags('shipping-work')
@Controller('shipping-work')
export class ShippingWorkController {
  constructor(private readonly work: ShippingWorkService) {}

  @Get('packing')
  @RequirePermissions('shipping:weigh')
  @ApiOperation({ summary: 'Orders waiting to be packed (weight/dimensions).' })
  packing() {
    return this.work.packingQueue();
  }

  @Get('ordering')
  @RequirePermissions('shipping:backfill')
  @ApiOperation({ summary: 'Packed orders waiting for carrier + tracking.' })
  ordering() {
    return this.work.orderingQueue();
  }

  @Get('inspection')
  @RequirePermissions('shipping:inspect')
  @ApiOperation({ summary: 'Orders waiting for the spot-check confirmation.' })
  inspection() {
    return this.work.inspectionQueue();
  }

  @Get('tail')
  @RequirePermissions('shipping:tail')
  @ApiOperation({ summary: 'Completed cross-border shipments missing tail tracking.' })
  tail() {
    return this.work.tailQueue();
  }

  @Post(':orderId/pack')
  @RequirePermissions('shipping:weigh')
  @ApiOperation({ summary: 'Confirm packing (weight/dimensions) and move to ordering.' })
  pack(
    @Param('orderId') orderId: string,
    @Body() dto: PackShipmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.work.pack(orderId, dto, user.id);
  }

  @Get(':orderId/packing-preview')
  @RequirePermissions('shipping:weigh')
  @ApiOperation({ summary: 'Second-confirmation data: products, gifts and stock deduction rows.' })
  packingPreview(@Param('orderId') orderId: string) {
    return this.work.packingPreview(orderId);
  }

  @Post(':orderId/return-to-review')
  @RequirePermissions('shipping:return')
  @ApiOperation({ summary: 'Return a packed order back to the unfulfilled review.' })
  returnToReview(
    @Param('orderId') orderId: string,
    @Body() dto: { note?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.work.returnToReview(orderId, user.id, dto.note);
  }

  @Post(':orderId/add-ons')
  @RequirePermissions('shipping:weigh')
  @ApiOperation({ summary: 'Add a gift/extra item while packing.' })
  addAddOn(
    @Param('orderId') orderId: string,
    @Body() dto: CreateAddOnDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.work.addAddOn(orderId, dto, user.id);
  }

  @Delete(':orderId/add-ons/:addOnId')
  @RequirePermissions('shipping:weigh')
  @ApiOperation({ summary: 'Remove a gift/extra item before packing is confirmed.' })
  removeAddOn(
    @Param('orderId') orderId: string,
    @Param('addOnId') addOnId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.work.removeAddOn(orderId, addOnId, user.id);
  }

  @Post(':orderId/tracking')
  @RequirePermissions('shipping:backfill')
  @ApiOperation({ summary: 'Attach carrier + tracking and move to inspection.' })
  tracking(
    @Param('orderId') orderId: string,
    @Body() dto: ShipmentEntryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.work.setTracking(orderId, dto, user.id);
  }

  @Post(':orderId/inspect')
  @RequirePermissions('shipping:inspect')
  @ApiOperation({
    summary: 'Confirm spot-check: complete the order and push fulfillment to the store.',
  })
  inspect(
    @Param('orderId') orderId: string,
    @Body() dto: InspectShipmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.work.inspect(orderId, user.id, dto.note);
  }

  @Post(':orderId/tail')
  @RequirePermissions('shipping:tail')
  @ApiOperation({ summary: 'Save tail (last-mile) tracking for a cross-border shipment.' })
  tailTracking(
    @Param('orderId') orderId: string,
    @Body() dto: TailTrackingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.work.setTail(orderId, dto, user.id);
  }
}
