import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  assertNoteOwnerType,
  NOTE_OWNER_TYPES,
  NotesService,
} from '../notes/notes.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { AuthUser } from '../auth/auth.types';
import { ItemsService } from './items.service';
import {
  CreateItemDto,
  CreateItemVariantDto,
  CreateItemVariantsBatchDto,
  ListItemsQueryDto,
  UpdateItemDto,
  UpdateItemVariantDto,
} from './dto/item.dto';

export class CreateNoteDto {
  @ApiProperty({ minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  body!: string;
}

@ApiTags('items')
@Controller('items')
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly notes: NotesService,
  ) {}

  @Post()
  @RequirePermissions('items:create')
  @ApiOperation({ summary: 'Create an internal Item.' })
  create(@Body() dto: CreateItemDto, @CurrentUser() user: AuthUser) {
    return this.items.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('items:read')
  @ApiOperation({ summary: 'List Items with search, archive filter, and pagination.' })
  list(@Query() query: ListItemsQueryDto) {
    return this.items.list(query);
  }

  @Get(':id')
  @RequirePermissions('items:read')
  @ApiOperation({ summary: 'Get an Item with variants and notes.' })
  get(@Param('id') id: string) {
    return this.items.get(id);
  }

  @Patch(':id')
  @RequirePermissions('items:update')
  @ApiOperation({ summary: 'Update an Item; creates a new content version.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.items.update(id, dto, user.id);
  }

  @Post(':id/archive')
  @RequirePermissions('items:archive')
  @ApiOperation({ summary: 'Archive an Item.' })
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.items.archive(id, user.id);
  }

  @Post(':id/restore')
  @RequirePermissions('items:update')
  @ApiOperation({ summary: 'Restore an archived Item.' })
  restore(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.items.restore(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('items:delete')
  @ApiOperation({ summary: 'Permanently delete an Item (audit recorded).' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.items.remove(id, user.id);
    return { ok: true };
  }

  @Post(':id/variants')
  @RequirePermissions('items:create')
  @ApiOperation({ summary: 'Add a variant; a permanent Item Code is generated.' })
  createVariant(
    @Param('id') id: string,
    @Body() dto: CreateItemVariantDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.items.createVariant(id, dto, user.id);
  }

  @Post(':id/variants/batch')
  @RequirePermissions('items:create')
  @ApiOperation({
    summary: 'Generate variants from option axes (cartesian product, auto names).',
  })
  createVariantsBatch(
    @Param('id') id: string,
    @Body() dto: CreateItemVariantsBatchDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.items.createVariantsBatch(id, dto, user.id);
  }

  @Patch(':id/variants/:variantId')
  @RequirePermissions('items:update')
  @ApiOperation({ summary: 'Update a variant; creates a new content version.' })
  updateVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateItemVariantDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.items.updateVariant(id, variantId, dto, user.id);
  }

  @Delete(':id/variants/:variantId')
  @RequirePermissions('items:delete')
  @ApiOperation({
    summary: 'Permanently delete an unreferenced variant; referenced ones can only be archived.',
  })
  deleteVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.items.deleteVariant(id, variantId, user.id);
  }

  @Post(':id/variants/:variantId/archive')
  @RequirePermissions('items:archive')
  @ApiOperation({ summary: 'Archive a variant.' })
  archiveVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.items.archiveVariant(id, variantId, user.id);
  }

  @Post(':id/variants/:variantId/restore')
  @RequirePermissions('items:archive')
  @ApiOperation({ summary: 'Restore an archived variant.' })
  restoreVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.items.restoreVariant(id, variantId, user.id);
  }

  @Post(':id/notes')
  @RequirePermissions('notes:create')
  @ApiOperation({ summary: 'Add a Local Note to the Item.' })
  addNote(
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notes.create('item', id, dto.body, user.id);
  }

  @Get(':id/notes')
  @RequirePermissions('notes:read')
  @ApiOperation({ summary: 'List the Item notes.' })
  listNotes(@Param('id') id: string) {
    return this.notes.list('item', id);
  }
}

@ApiTags('notes')
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit a note (requires notes:edit-all, or notes:edit-own for your own notes).',
  })
  update(
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notes.update(id, dto.body, user);
  }

  @Delete(':id')
  @RequirePermissions('notes:delete')
  @ApiOperation({ summary: 'Delete a note.' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.notes.remove(id, user.id);
    return { ok: true };
  }
}

/** Note routes for any note-capable owner object (order lines, listings, ...). */
@ApiTags('notes')
@Controller('notes/owner/:ownerType/:ownerId')
export class OwnerNotesController {
  constructor(private readonly notes: NotesService) {}

  static readonly ownerTypes = NOTE_OWNER_TYPES;

  @Get()
  @RequirePermissions('notes:read')
  @ApiOperation({ summary: 'List notes for a note-capable owner object.' })
  list(
    @Param('ownerType') ownerType: string,
    @Param('ownerId') ownerId: string,
  ) {
    assertNoteOwnerType(ownerType);
    return this.notes.list(ownerType, ownerId);
  }

  @Post()
  @RequirePermissions('notes:create')
  @ApiOperation({ summary: 'Add a Local Note to a note-capable owner object.' })
  async create(
    @Param('ownerType') ownerType: string,
    @Param('ownerId') ownerId: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertNoteOwnerType(ownerType);
    return this.notes.create(ownerType, ownerId, dto.body, user.id);
  }
}
