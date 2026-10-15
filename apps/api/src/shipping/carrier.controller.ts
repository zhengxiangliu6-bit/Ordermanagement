import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import {
  CarrierCollisionsDto,
  CarrierInputDto,
  CarrierPreviewDto,
} from './dto/carrier.dto';
import { CarrierService } from './carrier.service';

@ApiTags('carriers')
@Controller('carriers')
export class CarrierController {
  constructor(private readonly carriers: CarrierService) {}

  @Get()
  @RequirePermissions('carrier-providers:read')
  @ApiOperation({ summary: 'List configured carriers.' })
  list() {
    return this.carriers.list();
  }

  @Post()
  @RequirePermissions('carrier-providers:manage')
  @ApiOperation({ summary: 'Create a carrier with recognition/transform rules.' })
  create(@Body() dto: CarrierInputDto) {
    return this.carriers.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('carrier-providers:manage')
  @ApiOperation({ summary: 'Update a carrier (transform changes must bump version).' })
  update(@Param('id') id: string, @Body() dto: CarrierInputDto) {
    return this.carriers.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('carrier-providers:manage')
  @ApiOperation({ summary: 'Delete a carrier (blocked when shipments reference it).' })
  async remove(@Param('id') id: string) {
    await this.carriers.remove(id);
    return { ok: true };
  }

  @Post('preview')
  @RequirePermissions('shipping:read')
  @ApiOperation({
    summary: 'Recognize a tracking number and preview the public tracking result.',
  })
  preview(@Body() dto: CarrierPreviewDto) {
    return this.carriers.preview(dto.trackingNumber, dto.carrierId);
  }

  @Post(':id/collisions')
  @RequirePermissions('carrier-providers:manage')
  @ApiOperation({ summary: 'Run collision detection over sample tracking numbers.' })
  collisions(@Param('id') id: string, @Body() dto: CarrierCollisionsDto) {
    return this.carriers.collisions(id, dto.samples);
  }
}
