import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CarrierController } from './carrier.controller';
import { CarrierService } from './carrier.service';
import { OutboundExecutorService } from './outbound-executor.service';
import { OutboundSchedulerService } from './outbound-scheduler.service';
import { ShipmentController } from './shipment.controller';
import { ShipmentListController } from './shipment-list.controller';
import { ShipmentService } from './shipment.service';
import { TrackingService } from './tracking.service';
import { ShippingSettingsController } from './shipping-settings.controller';
import { ShippingSettingsService } from './shipping-settings.service';

@Module({
  imports: [AuditModule],
  controllers: [
    CarrierController,
    ShipmentController,
    ShipmentListController,
    ShippingSettingsController,
  ],
  providers: [
    CarrierService,
    ShipmentService,
    TrackingService,
    ShippingSettingsService,
    OutboundExecutorService,
    OutboundSchedulerService,
  ],
  exports: [
    ShipmentService,
    ShippingSettingsService,
    OutboundExecutorService,
    OutboundSchedulerService,
  ],
})
export class ShippingModule {}
