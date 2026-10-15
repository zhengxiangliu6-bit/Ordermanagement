import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SimulatedAdapter } from './simulated.adapter';
import { RelayShopifyAdapter } from './relay-shopify.adapter';
import { PlatformDevController } from './platform-dev.controller';
import { SyncService } from '../sync/sync.service';

@Module({
  imports: [AuditModule],
  controllers: [PlatformDevController],
  providers: [SimulatedAdapter, RelayShopifyAdapter, SyncService],
  exports: [SimulatedAdapter, RelayShopifyAdapter, SyncService],
})
export class PlatformModule {}
