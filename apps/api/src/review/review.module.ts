import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlatformModule } from '../platforms/platform.module';
import { ShippingModule } from '../shipping/shipping.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

@Module({
  imports: [AuditModule, PlatformModule, ShippingModule],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
