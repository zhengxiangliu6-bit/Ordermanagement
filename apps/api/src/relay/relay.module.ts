import { Global, Module } from '@nestjs/common';
import { RelayClient } from './relay.client';

@Global()
@Module({
  providers: [RelayClient],
  exports: [RelayClient],
})
export class RelayModule {}
