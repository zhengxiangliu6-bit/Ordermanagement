import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { SessionGuard } from './auth/session.guard';
import { HealthModule } from './health/health.module';
import { ItemsModule } from './items/items.module';
import { JobsModule } from './jobs/jobs.module';
import { OrdersModule } from './orders/orders.module';
import { MappingModule } from './mapping/mapping.module';
import { PermissionsGuard } from './rbac/permissions.guard';
import { ReviewModule } from './review/review.module';
import { PrismaModule } from './prisma/prisma.module';
import { RelayModule } from './relay/relay.module';
import { StoresModule } from './stores/stores.module';
import { SyncModule } from './sync/sync.module';
import { ShippingModule } from './shipping/shipping.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { InventoryModule } from './inventory/inventory.module';

@Module({
  imports: [
    AttachmentsModule,
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RelayModule,
    HealthModule,
    JobsModule,
    ItemsModule,
    MappingModule,
    OrdersModule,
    ReviewModule,
    StoresModule,
    SyncModule,
    UsersModule,
    CategoriesModule,
    InventoryModule,
    AuthModule,
    ShippingModule,
  ],
  providers: [
    // Order matters: the session guard authenticates the request first,
    // the permissions guard then enforces RBAC on top of it.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
