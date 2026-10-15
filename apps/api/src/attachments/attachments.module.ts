import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { storageDriverProvider } from '../storage/storage.module';

@Module({
  imports: [AuditModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, storageDriverProvider],
})
export class AttachmentsModule {}
