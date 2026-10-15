import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';

@Module({
  // SyncService / SimulatedAdapter live in PlatformModule (single instance);
  // this module only serves the Listings read surface.
  controllers: [ListingsController],
})
export class SyncModule {}
