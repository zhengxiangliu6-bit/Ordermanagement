import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrdersModule } from '../orders/orders.module';
import { InventoryModule } from '../inventory/inventory.module';
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
import { ShippingMethodsController } from './shipping-methods.controller';
import { ShippingRegionsController } from './shipping-regions.controller';
import { ShippingWorkController } from './shipping-work.controller';
import { ShippingWorkService } from './shipping-work.service';
import { ProblemItemsController, ProblemReportController } from './problem-items.controller';
import { ProblemItemsService } from './problem-items.service';

@Module({
  imports: [AuditModule, OrdersModule, InventoryModule],
  controllers: [
    CarrierController,
    ShipmentController,
    ShipmentListController,
    ShippingSettingsController,
    ShippingMethodsController,
    ShippingRegionsController,
    ShippingWorkController,
    ProblemItemsController,
    ProblemReportController,
  ],
  providers: [
    CarrierService,
    ShipmentService,
    TrackingService,
    ShippingSettingsService,
    OutboundExecutorService,
    OutboundSchedulerService,
    ShippingWorkService,
    ProblemItemsService,
  ],
  exports: [
    ShipmentService,
    ShippingSettingsService,
    OutboundExecutorService,
    OutboundSchedulerService,
  ],
})
export class ShippingModule {}
