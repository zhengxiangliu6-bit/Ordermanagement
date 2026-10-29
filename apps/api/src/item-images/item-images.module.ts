import { Module } from '@nestjs/common';
import { storageDriverProvider } from '../storage/storage.module';
import { ItemImagesController } from './item-images.controller';
import { ItemImagesService } from './item-images.service';

@Module({
  controllers: [ItemImagesController],
  providers: [ItemImagesService, storageDriverProvider],
})
export class ItemImagesModule {}
