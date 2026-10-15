import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { SimulatedAdapter } from './simulated.adapter';
import {
  InjectListingDto,
  InjectOrderDto,
  ListingUpdateEventDto,
  OrderUpdateEventDto,
} from './dto/simulate.dto';

/**
 * Demo/testing hooks for the simulated platform: inject new listings,
 * orders, and listing-update events so the full import → review → mapping
 * pipeline can be exercised without real Shopify/Etsy calls.
 */
@ApiTags('platform (simulated)')
@Controller('platform/simulate')
export class PlatformDevController {
  constructor(private readonly adapter: SimulatedAdapter) {}

  @Post('inject-listing')
  @RequirePermissions('stores:configure')
  @ApiOperation({ summary: 'Inject a brand-new listing on the simulated platform.' })
  injectListing(@Body() dto: InjectListingDto) {
    this.adapter.injectListing({
      externalListingId: dto.externalListingId,
      status: dto.status ?? 'active',
      title: dto.title,
      description: dto.description,
      sourceUpdatedAt: new Date().toISOString(),
      variants: [],
    });
    return { ok: true };
  }

  @Post('listing-update')
  @RequirePermissions('stores:configure')
  @ApiOperation({ summary: 'Patch a simulated listing (creates an update event).' })
  listingUpdate(@Body() dto: ListingUpdateEventDto) {
    const ok = this.adapter.updateListing(dto.externalListingId, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    });
    return { ok };
  }

  @Post('order-update')
  @RequirePermissions('stores:configure')
  @ApiOperation({ summary: 'Patch a simulated order (creates an order update event).' })
  orderUpdate(@Body() dto: OrderUpdateEventDto) {
    const ok = this.adapter.updateOrder(dto.externalOrderId, {
      ...(dto.buyerNote !== undefined ? { buyerNote: dto.buyerNote } : {}),
      ...(dto.customerName !== undefined ? { customerName: dto.customerName } : {}),
    });
    return { ok };
  }

  @Post('inject-order')
  @RequirePermissions('stores:configure')
  @ApiOperation({ summary: 'Inject a new order on the simulated platform.' })
  injectOrder(@Body() dto: InjectOrderDto) {
    this.adapter.injectOrder({
      externalOrderId: dto.externalOrderId,
      displayNumber: dto.displayNumber,
      statusRaw: { financialStatus: 'paid' },
      customer: { name: dto.customerName, email: dto.customerEmail },
      sourceUpdatedAt: new Date().toISOString(),
      lines: dto.lines.map((line, index) => ({
        externalLineId: `${dto.externalOrderId}-L${index + 1}`,
        title: line.title,
        quantity: line.quantity ?? 1,
        listingExternalId: line.listingExternalId,
        variantExternalId: line.variantExternalId,
      })),
    });
    return { ok: true };
  }
}

