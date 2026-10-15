import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlatformModule } from '../platforms/platform.module';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

@Module({
  // SimulatedAdapter / SyncService are owned by PlatformModule; importing it
  // guarantees a single adapter instance so dev-injected platform changes are
  // visible to the Stores synchronize flow.
  imports: [AuditModule, PlatformModule],
  controllers: [StoresController],
  providers: [StoresService],
})
export class StoresModule {}
