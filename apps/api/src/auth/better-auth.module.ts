import { Module } from '@nestjs/common';
import { betterAuthProvider } from './better-auth.provider';

/**
 * Owns the shared Better Auth instance. Kept separate from AuthModule so
 * feature modules (e.g. Users) can inject it without introducing module
 * cycles.
 */
@Module({
  providers: [betterAuthProvider],
  exports: [betterAuthProvider],
})
export class BetterAuthModule {}
