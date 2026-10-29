import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { CreateProblemDto, ResolveProblemDto } from './dto/shipping.dto';
import { ProblemItemsService } from './problem-items.service';

/** Problem-item review queue (M7c). Report lives under /shipping-work/:id/problem. */
@ApiTags('problem-items')
@Controller('problem-items')
export class ProblemItemsController {
  constructor(private readonly problems: ProblemItemsService) {}

  @Get()
  @RequirePermissions('shipping:issue-review')
  @ApiOperation({ summary: 'List open problem items with order context.' })
  list() {
    return this.problems.list();
  }

  @Post(':id/resolve')
  @RequirePermissions('shipping:issue-review')
  @ApiOperation({
    summary: 'Resolve a problem: cancel, restart the original, or copy a new order.',
  })
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveProblemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.problems.resolve(id, dto, user.id);
  }
}

/** Report endpoint kept on the shipping-work controller surface. */
@ApiTags('problem-items')
@Controller('shipping-work')
export class ProblemReportController {
  constructor(private readonly problems: ProblemItemsService) {}

  @Post(':orderId/problem')
  @RequirePermissions('shipping:issue-report')
  @ApiOperation({ summary: 'Mark an order as a problem item (any stage).' })
  report(
    @Param('orderId') orderId: string,
    @Body() dto: CreateProblemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.problems.report(orderId, dto, user.id);
  }
}
