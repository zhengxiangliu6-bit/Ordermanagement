import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { STORAGE_DRIVER } from '../storage/storage.types';
import type { StorageDriver } from '../storage/storage.types';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 24_000_000;
const ID_PATTERN = /^[a-f0-9]{64}$/;

export class UploadedItemImage {
  @ApiProperty()
  url!: string;
  @ApiProperty()
  thumbnailUrl!: string;
  @ApiProperty()
  sizeBytes!: number;
  @ApiProperty()
  thumbnailSizeBytes!: number;
  @ApiProperty()
  width!: number;
  @ApiProperty()
  height!: number;
}

/** Immutable, content-addressed catalog images, stored beside attachments. */
@Injectable()
export class ItemImagesService {
  private activeUploads = 0;

  constructor(
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async upload(input: Buffer): Promise<UploadedItemImage> {
    if (!input.length || input.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Choose an image no larger than 10 MiB.');
    }
    // Reject excess work rather than queueing many decoded images in memory.
    if (this.activeUploads >= 2)
      throw new HttpException(
        'Image processing is busy. Please retry shortly.',
        429,
      );
    this.activeUploads++;
    try {
      const { display, thumbnail, width, height } = await this.process(input);
      const id = createHash('sha256').update(display).digest('hex');
      const displayKey = `catalog-images/${id}/display.webp`;
      const thumbKey = `catalog-images/${id}/thumbnail.webp`;
      // Same optimized content shares the same files. Thumbnail is committed first.
      if (!(await this.storage.exists(thumbKey)))
        await this.storage.put(thumbKey, thumbnail);
      if (!(await this.storage.exists(displayKey)))
        await this.storage.put(displayKey, display);
      return {
        url: `/api/v1/item-images/${id}/display.webp`,
        thumbnailUrl: `/api/v1/item-images/${id}/thumbnail.webp`,
        sizeBytes: display.length,
        thumbnailSizeBytes: thumbnail.length,
        width,
        height,
      };
    } finally {
      this.activeUploads--;
    }
  }

  private async process(input: Buffer) {
    try {
      const options = {
        limitInputPixels: MAX_IMAGE_PIXELS,
        failOn: 'warning' as const,
        sequentialRead: true,
      };
      const metadata = await sharp(input, options).metadata();
      if (
        !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
        (metadata.pages ?? 1) > 1
      ) {
        throw new Error('Unsupported image format.');
      }
      const { data: display, info } = await sharp(input, options)
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        // Sharp strips EXIF/GPS and other input metadata by default.
        .webp({ quality: 80, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      const thumbnail = await sharp(display)
        .resize({
          width: 320,
          height: 320,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 72, effort: 3 })
        .toBuffer();
      return { display, thumbnail, width: info.width, height: info.height };
    } catch {
      throw new BadRequestException(
        'Use a valid, static JPEG, PNG or WebP image, up to 24 megapixels and 10 MiB.',
      );
    }
  }

  async read(id: string, size: string): Promise<Buffer> {
    if (
      !ID_PATTERN.test(id) ||
      !['display.webp', 'thumbnail.webp'].includes(size)
    ) {
      throw new NotFoundException('Image not found.');
    }
    try {
      return await this.storage.get(`catalog-images/${id}/${size}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new NotFoundException('Image not found.');
      throw error;
    }
  }
}
