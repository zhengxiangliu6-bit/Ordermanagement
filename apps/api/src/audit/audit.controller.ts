import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'List audit history with filters and pagination.' })
  list(@Query() query: AuditQueryDto) {
    return this.audit.list({
      objectType: query.objectType,
      action: query.action,
      actorId: query.actorId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }
}
