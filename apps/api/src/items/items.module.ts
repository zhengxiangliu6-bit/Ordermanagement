import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ItemsController } from './items.controller';
import { ItemVariantsController } from './item-variants.controller';
import { ItemsService } from './items.service';
import { NotesController, OwnerNotesController } from './items.controller';
import { NotesService } from '../notes/notes.service';

@Module({
  imports: [AuditModule],
  controllers: [ItemsController, ItemVariantsController, NotesController, OwnerNotesController],
  providers: [ItemsService, NotesService],
})
export class ItemsModule {}
