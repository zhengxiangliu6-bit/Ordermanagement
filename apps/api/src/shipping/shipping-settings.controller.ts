import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ShippingSettingsPatchDto } from './dto/shipping.dto';
import { ShippingSettingsService } from './shipping-settings.service';

@ApiTags('shipping-settings')
@Controller('shipping-settings')
export class ShippingSettingsController {
  constructor(private readonly settings: ShippingSettingsService) {}

  @Get()
  @RequirePermissions('shipping:read')
  @ApiOperation({ summary: 'Global shipping settings (External Timezone, policies, schedule).' })
  get() {
    return this.settings.get();
  }

  @Patch()
  @RequirePermissions('shipping:manage-settings')
  @ApiOperation({ summary: 'Update global shipping settings (validated, audited).' })
  update(@Body() dto: ShippingSettingsPatchDto, @CurrentUser() user: AuthUser) {
    return this.settings.update(dto, user.id);
  }
}
