import 'reflect-metadata';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  BadRequestException,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ItemImagesService, MAX_IMAGE_BYTES } from './item-images.service';
import { ItemImagesController } from './item-images.controller';
import { LocalVolumeDriver } from '../storage/local-volume.driver';
import { STORAGE_DRIVER } from '../storage/storage.types';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { setRequestUser } from '../auth/request-user';
import type { AuthUser } from '../auth/auth.types';

let root: string;
let storage: LocalVolumeDriver;
let service: ItemImagesService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'om-item-images-'));
  storage = new LocalVolumeDriver(root);
  service = new ItemImagesService(storage);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const image = (width = 2000, height = 1000) =>
  sharp({ create: { width, height, channels: 3, background: '#cc2233' } })
    .png()
    .toBuffer();

describe('stored catalog images', () => {
  it('writes compressed display/thumbnail images, strips metadata, and deduplicates uploads', async () => {
    const input = await sharp(await image())
      .withMetadata()
      .jpeg()
      .toBuffer();
    const result = await service.upload(input);
    expect(result).toMatchObject({ width: 1600, height: 800 });
    const id = result.url.split('/').at(-2)!;
    const display = await service.read(id, 'display.webp');
    const thumbnail = await service.read(id, 'thumbnail.webp');
    expect(await sharp(display).metadata()).toMatchObject({
      format: 'webp',
      width: 1600,
      height: 800,
    });
    expect((await sharp(display).metadata()).exif).toBeUndefined();
    expect(await sharp(thumbnail).metadata()).toMatchObject({
      format: 'webp',
      width: 320,
      height: 160,
    });
    expect(display.length).toBeLessThan(input.length);
    expect((await service.upload(input)).url).toBe(result.url);
    expect(await readdir(join(root, 'catalog-images'))).toEqual([id]);
    expect((await readdir(join(root, 'catalog-images', id))).sort()).toEqual([
      'display.webp',
      'thumbnail.webp',
    ]);
  });

  it('does not enlarge small images and rejects invalid, active or excessive inputs', async () => {
    expect(await service.upload(await image(100, 50))).toMatchObject({
      width: 100,
      height: 50,
    });
    for (const input of [
      Buffer.from('not an image'),
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      ),
      Buffer.alloc(MAX_IMAGE_BYTES + 1),
      await image(5000, 5000),
    ]) {
      await expect(service.upload(input)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('does not accept arbitrary storage paths', async () => {
    await expect(service.read('../etc', 'display.webp')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.read('a'.repeat(64), 'original.jpg'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.read('a'.repeat(64), 'display.webp'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects excess concurrent processing and releases capacity after a failure', async () => {
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const exists = vi.spyOn(storage, 'exists').mockImplementation(async () => {
      await gate;
      return false;
    });
    const input = await image(10, 10);
    const first = service.upload(input);
    const second = service.upload(input);
    await expect(service.upload(input)).rejects.toMatchObject({ status: 429 });
    unblock();
    await Promise.all([first, second]);
    exists.mockRestore();
    await expect(service.upload(Buffer.from('bad'))).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.upload(input)).resolves.toHaveProperty('url');
  });
});

describe('image HTTP endpoints with permission guard', () => {
  let app: INestApplication;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [ItemImagesController],
      providers: [
        Reflector,
        { provide: STORAGE_DRIVER, useValue: storage },
        ItemImagesService,
        // Test session adapter; the production AppModule uses SessionGuard.
        {
          provide: APP_GUARD,
          useValue: {
            canActivate(context: {
              switchToHttp(): { getRequest(): request.Request };
            }) {
              const req = context
                .switchToHttp()
                .getRequest() as unknown as import('express').Request;
              const permission = req.headers['x-test-permission'];
              if (typeof permission !== 'string')
                throw new UnauthorizedException();
              setRequestUser(req, {
                id: 'test-user',
                permissions: [permission],
              } as AuthUser);
              return true;
            },
          },
        },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('uploads, serves a real thumbnail, revalidates cache and enforces route permissions', async () => {
    const input = await image();
    await request(app.getHttpServer())
      .post('/api/v1/item-images')
      .attach('file', input, 'photo.png')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/item-images')
      .set('x-test-permission', 'items:read')
      .attach('file', input, 'photo.png')
      .expect(403);
    const upload = await request(app.getHttpServer())
      .post('/api/v1/item-images')
      .set('x-test-permission', 'items:create')
      .attach('file', input, 'photo.png')
      .expect(201);
    await request(app.getHttpServer())
      .get(upload.body.thumbnailUrl)
      .expect(401);
    const thumbnail = await request(app.getHttpServer())
      .get(upload.body.thumbnailUrl)
      .set('x-test-permission', 'orders:read')
      .expect(200)
      .expect('Content-Type', /image\/webp/)
      .expect('Cache-Control', 'private, no-cache');
    expect((await sharp(thumbnail.body as Buffer).metadata()).width).toBe(320);
    await request(app.getHttpServer())
      .get(upload.body.thumbnailUrl)
      .set('x-test-permission', 'orders:read')
      .set('If-None-Match', thumbnail.headers.etag)
      .expect(304);
    await request(app.getHttpServer())
      .post('/api/v1/item-images')
      .set('x-test-permission', 'items:create')
      .attach('file', Buffer.from('fake'), 'photo.png')
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/item-images')
      .set('x-test-permission', 'items:create')
      .attach('file', Buffer.alloc(MAX_IMAGE_BYTES + 1), 'photo.png')
      .expect(413);
  });
});
