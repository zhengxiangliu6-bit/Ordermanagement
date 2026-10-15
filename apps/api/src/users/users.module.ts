import { Module } from '@nestjs/common';
import { BetterAuthModule } from '../auth/better-auth.module';
import { AuditModule } from '../audit/audit.module';
import { MeActionsController, UsersController } from './users.controller';
import { UsersAdminService } from './users.admin.service';
import { UsersService } from './users.service';

@Module({
  imports: [AuditModule, BetterAuthModule],
  controllers: [UsersController, MeActionsController],
  providers: [UsersService, UsersAdminService],
  exports: [UsersService],
})
export class UsersModule {}
