import { Module } from '@nestjs/common';
import { BetterAuthModule } from './better-auth.module';
import { AuthController } from './auth.controller';
import { SessionGuard } from './session.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule, BetterAuthModule],
  controllers: [AuthController],
  providers: [SessionGuard],
  exports: [BetterAuthModule],
})
export class AuthModule {}
