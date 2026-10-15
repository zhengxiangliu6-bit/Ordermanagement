import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import {
  RecognizeTrackingDto,
  ShipmentEntryDto,
  ShipmentPreviewDto,
  ShipmentRevisionDto,
} from './dto/shipping.dto';
import { ShipmentService } from './shipment.service';
import { TrackingService } from './tracking.service';

@ApiTags('shipments')
@Controller('orders/:orderId/shipments')
export class ShipmentController {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly tracking: TrackingService,
  ) {}

  @Post('recognize')
  @RequirePermissions('shipping:enter')
  @ApiOperation({
    summary:
      'Recognize a tracking number: single match, ambiguous candidates, or none (§12.3).',
  })
  recognize(@Param('orderId') orderId: string, @Body() dto: RecognizeTrackingDto) {
    return this.shipments.recognize(orderId, dto.trackingNumber);
  }

  @Post('preview')
  @RequirePermissions('shipping:enter')
  @ApiOperation({
    summary:
      'Preview one carrier choice: public tracking result, policy, and planned send time (§12.3 step 6).',
  })
  preview(
    @Param('orderId') orderId: string,
    @Body() dto: ShipmentPreviewDto,
  ) {
    return this.shipments.preview(orderId, dto.carrierId, dto.trackingNumber);
  }

  @Post()
  @RequirePermissions('shipping:enter')
  @ApiOperation({ summary: 'Record the local shipping fact (first release: one per order).' })
  create(
    @Param('orderId') orderId: string,
    @Body() dto: ShipmentEntryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.shipments.create(orderId, dto, user.id);
  }

  @Post(':shipmentId/revisions')
  @RequirePermissions('shipping:revise')
  @ApiOperation({
    summary: 'Correct a shipment: new values + reason, then the revision policy (§12.12).',
  })
  revise(
    @Param('orderId') orderId: string,
    @Param('shipmentId') shipmentId: string,
    @Body() dto: ShipmentRevisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.shipments.revise(orderId, shipmentId, dto, user.id);
  }

  @Get()
  @RequirePermissions('shipping:read')
  @ApiOperation({ summary: 'Shipments recorded for the order.' })
  list(@Param('orderId') orderId: string) {
    return this.shipments.list(orderId);
  }

  @Get(':shipmentId/tracking')
  @RequirePermissions('shipping:read')
  @ApiOperation({
    summary: 'Tracking snapshot for the shipment, with URL fallback (§12.6).',
  })
  getTracking(
    @Param('orderId') orderId: string,
    @Param('shipmentId') shipmentId: string,
  ) {
    return this.tracking.forShipment(orderId, shipmentId);
  }
}
