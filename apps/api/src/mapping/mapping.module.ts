import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MappingController } from './mapping.controller';
import { MappingService } from './mapping.service';

@Module({
  imports: [AuditModule],
  controllers: [MappingController],
  providers: [MappingService],
})
export class MappingModule {}
