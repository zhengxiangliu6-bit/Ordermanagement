import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import {
  assertAttachmentOwnerType,
  AttachmentsService,
} from './attachments.service';

@ApiTags('attachments')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @RequirePermissions('attachments:upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload an attachment for an owner object.' })
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { ownerType: string; ownerId: string },
    @CurrentUser() user: AuthUser,
  ) {
    assertAttachmentOwnerType(body.ownerType);
    if (!file || !file.buffer?.length) {
      // Reject explicitly rather than storing an empty attachment.
      throw new BadRequestException('file is required');
    }
    const attachment = await this.attachments.create(
      body.ownerType as Parameters<AttachmentsService['create']>[0],
      body.ownerId,
      file,
      user.id,
    );
    return attachment;
  }

  @Get()
  @RequirePermissions('attachments:view-metadata')
  @ApiOperation({ summary: 'List attachments of an owner object.' })
  list(@Query('ownerType') ownerType: string, @Query('ownerId') ownerId: string) {
    assertAttachmentOwnerType(ownerType);
    return this.attachments.list(ownerType, ownerId);
  }

  @Get(':id/download')
  @RequirePermissions('attachments:open')
  @ApiOperation({ summary: 'Download attachment content.' })
  async download(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { attachment, content } = await this.attachments.getWithContent(id);
    res.setHeader('Content-Type', attachment.mimeType ?? 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
    );
    res.send(content);
  }

  @Delete(':id')
  @RequirePermissions('attachments:delete')
  @ApiOperation({ summary: 'Delete an attachment (content + metadata).' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.attachments.remove(id, user.id);
    return { ok: true };
  }
}
