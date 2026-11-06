import { Module } from '@nestjs/common';
import { EtsyOAuthController } from './etsy-oauth.controller';
import { EtsyOAuthService } from './etsy-oauth.service';

@Module({
  controllers: [EtsyOAuthController],
  providers: [EtsyOAuthService],
})
export class EtsyOAuthModule {}
