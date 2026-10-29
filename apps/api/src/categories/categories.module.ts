import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CategoriesController } from './categories.controller';

@Module({
  imports: [AuditModule],
  controllers: [CategoriesController],
})
export class CategoriesModule {}
