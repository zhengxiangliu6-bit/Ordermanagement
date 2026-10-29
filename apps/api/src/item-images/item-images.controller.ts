import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RequireAnyPermissions } from '../rbac/require-permissions.decorator';
import {
  ItemImagesService,
  MAX_IMAGE_BYTES,
  UploadedItemImage,
} from './item-images.service';

@ApiTags('item-images')
@Controller('item-images')
export class ItemImagesController {
  constructor(private readonly images: ItemImagesService) {}

  @Post()
  @RequireAnyPermissions('items:create', 'items:update')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
    }),
  )
  @ApiOperation({
    summary:
      'Upload a static catalog image; stores optimized WebP and a thumbnail.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: UploadedItemImage })
  upload(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length)
      throw new BadRequestException('An image file is required.');
    return this.images.upload(file.buffer);
  }

  @Get(':id/:size')
  // Shared by catalog, order/review, mapping and warehouse screens.
  @RequireAnyPermissions(
    'items:read',
    'items:create',
    'items:update',
    'orders:read',
    'orders:review',
    'mapping:read',
    'shipping:read',
    'inventory:read',
    'inventory:china:read',
    'inventory:canada:read',
  )
  @ApiOperation({
    summary: 'Read a stored catalog image (authenticated session required).',
  })
  async read(
    @Param('id') id: string,
    @Param('size') size: string,
    @Res() response: Response,
  ) {
    const content = await this.images.read(id, size);
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Browser cache only; re-authenticate on subsequent requests/sessions.
    response.setHeader('Cache-Control', 'private, no-cache');
    response.setHeader('Vary', 'Cookie');
    response.send(content);
  }
}
