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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { NotesService } from '../notes/notes.service';
import { OrdersService } from './orders.service';
import {
  CancelOrderDto,
  UpdateOrderAssignmentDto,
  CreateManualOrderDto,
  CreateOrderLinkDto,
  ListOrdersQueryDto,
  ReviewCustomerDto,
  ReviewItemsDto,
  ReviseOrderDto,
} from './dto/order.dto';
import { CreateNoteDto } from '../items/items.controller';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly notes: NotesService,
  ) {}

    @Patch(':id/assignment')
  @RequirePermissions('orders:revise')
  @ApiOperation({ summary: 'Update shipping-method/category assignment (M7).' })
  updateAssignment(
    @Param('id') id: string,
    @Body() dto: UpdateOrderAssignmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.updateAssignment(id, dto, user.id);
  }

  @Post(':id/copy')
  @RequirePermissions('orders:create-manual')
  @ApiOperation({ summary: 'Duplicate an order as an editable manual order (M7 re-ship flow).' })
  copy(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.copyOrder(id, user.id);
  }

  @Patch(':id/review-items')
  @RequirePermissions('orders:review')
  @ApiOperation({ summary: 'Edit the ordered product lines during unfulfilled review.' })
  reviewItems(
    @Param('id') id: string,
    @Body() dto: ReviewItemsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.reviewItems(id, dto, user.id);
  }

  @Patch(':id/review-customer')
  @RequirePermissions('orders:review')
  @ApiOperation({ summary: 'Edit the customer snapshot during unfulfilled review.' })
  reviewCustomer(
    @Param('id') id: string,
    @Body() dto: ReviewCustomerDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.reviewCustomer(id, dto, user.id);
  }

  @Post(':id/cancel')
  @RequirePermissions('orders:cancel')
  @ApiOperation({ summary: 'Manually cancel an order (local cancellation; audit recorded).' })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.cancelOrder(id, user.id, dto.reason);
  }

@Post()
  @RequirePermissions('orders:create-manual')
  @ApiOperation({ summary: 'Create a manual order (title-only lines allowed).' })
  createManual(
    @Body() dto: CreateManualOrderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.createManual(dto, user.id);
  }

  @Get()
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'List orders with filters, search, and pagination.' })
  list(@Query() query: ListOrdersQueryDto) {
    return this.orders.list(query);
  }

  @Get(':id')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Order detail: lines, revisions, and notes.' })
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Patch(':id')
  @RequirePermissions('orders:revise')
  @ApiOperation({
    summary: 'Internal revision: applies changes and records reason + before/after.',
  })
  revise(
    @Param('id') id: string,
    @Body() dto: ReviseOrderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.revise(id, dto, user.id);
  }

  @Post(':id/archive')
  @RequirePermissions('orders:archive')
  @ApiOperation({ summary: 'Archive an order (precondition for deletion).' })
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.archive(id, user.id);
  }

  @Post(':id/restore')
  @RequirePermissions('orders:restore')
  @ApiOperation({ summary: 'Restore an archived order.' })
  restore(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.restore(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('orders:delete')
  @ApiOperation({ summary: 'Permanently delete an archived order (reason in body).' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason?: string },
  ) {
    await this.orders.remove(id, user.id, body?.reason ?? 'Deleted via API');
    return { ok: true };
  }

  @Post(':id/notes')
  @RequirePermissions('notes:create')
  @ApiOperation({ summary: 'Add a Local Note to the order.' })
  addNote(
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notes.create('order', id, dto.body, user.id);
  }

  @Get(':id/notes')
  @RequirePermissions('notes:read')
  @ApiOperation({ summary: 'List the order notes.' })
  listNotes(@Param('id') id: string) {
    return this.notes.list('order', id);
  }

  @Get(':id/related')
  @RequirePermissions('customers:read-basic')
  @ApiOperation({
    summary: 'Manually linked orders plus normalized-field suggestions (§17).',
  })
  related(@Param('id') id: string) {
    return this.orders.related(id);
  }

  @Post(':id/links')
  @RequirePermissions('customers:link')
  @ApiOperation({ summary: 'Manually link a related order.' })
  link(
    @Param('id') id: string,
    @Body() dto: CreateOrderLinkDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.link(id, dto.relatedOrderId, user.id);
  }

  @Delete(':id/links/:linkId')
  @RequirePermissions('customers:link')
  @ApiOperation({ summary: 'Remove a manual order link.' })
  async unlink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.unlink(id, linkId, user.id);
  }
}
