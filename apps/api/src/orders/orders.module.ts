import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotesService } from '../notes/notes.service';
import { ItemsModule } from '../items/items.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuditModule, ItemsModule, InventoryModule],
  controllers: [OrdersController],
  providers: [OrdersService, NotesService],
  exports: [OrdersService],
})
export class OrdersModule {}
