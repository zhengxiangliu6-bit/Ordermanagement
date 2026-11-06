import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, IsUrl, MaxLength } from 'class-validator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { EtsyOAuthService } from './etsy-oauth.service';

export class CompleteEtsyOAuthDto {
  @IsString()
  @MaxLength(4096)
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  callbackUrl!: string;
}

@ApiTags('etsy-oauth')
@Controller('stores/:storeId/etsy-oauth')
export class EtsyOAuthController {
  constructor(private readonly oauth: EtsyOAuthService) {}

  @Post('start')
  @RequirePermissions('stores:connect')
  @ApiOperation({ summary: 'Create Etsy OAuth URL with PKCE, for a registered Etsy store.' })
  start(@Param('storeId') storeId: string) {
    return this.oauth.start(storeId);
  }

  @Post('complete')
  @RequirePermissions('stores:connect')
  @ApiOperation({ summary: 'Redeem pasted Etsy callback URL; keeps tokens private.' })
  complete(@Param('storeId') storeId: string, @Body() body: CompleteEtsyOAuthDto) {
    return this.oauth.complete(storeId, body.callbackUrl);
  }

  @Get('status')
  @RequirePermissions('stores:read')
  @ApiOperation({ summary: 'Get non-secret Etsy authorization status.' })
  status(@Param('storeId') storeId: string) {
    return this.oauth.status(storeId);
  }
}
