import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { ConnectStoreDto, CreateStoreDto, ListStoresQueryDto, UpdateStoreDto } from './dto/store.dto';
import { StoresService } from './stores.service';
import { SyncService } from '../sync/sync.service';
import type { ExternalListing, ExternalOrder, PlatformAdapter } from '../platforms/platform-adapter';
import { SimulatedAdapter } from '../platforms/simulated.adapter';
import { RelayShopifyAdapter } from '../platforms/relay-shopify.adapter';
import { RelayCommandError } from '../relay/relay.client';
import type { Store } from '@prisma/client';

@ApiTags('stores')
@Controller('stores')
export class StoresController {
  constructor(
    private readonly stores: StoresService,
    private readonly sync: SyncService,
    private readonly simulatedAdapter: SimulatedAdapter,
    private readonly relayAdapter: RelayShopifyAdapter,
  ) {}

  /**
   * Adapter selection (M6): relay-backed stores pull real platform data
   * through the Relay Worker; everything else stays on the simulated
   * platform from M3. dataSource lives in store.settings and is set by
   * the connect flow.
   */
  private adapterFor(store: Store): PlatformAdapter {
    const settings = (store.settings ?? {}) as { dataSource?: string };
    if (store.platform === 'shopify' && settings.dataSource === 'relay') {
      return this.relayAdapter;
    }
    return this.simulatedAdapter;
  }

  @Post()
  @RequirePermissions('stores:connect')
  @ApiOperation({ summary: 'Register a Store; connect it before synchronizing.' })
  create(@Body() dto: CreateStoreDto, @CurrentUser() user: AuthUser) {
    return this.stores.create(dto, user.id);
  }

  @Post(':id/connect')
  @RequirePermissions('stores:connect')
  @ApiOperation({
    summary: 'Verify the relay-backed Shopify connection (scopes + shop domain) and connect the Store.',
  })
  async connect(@Param('id') id: string, @Body() dto: ConnectStoreDto, @CurrentUser() user: AuthUser) {
    try {
      return await this.stores.connectShopify(id, dto, user.id);
    } catch (error) {
      if (error instanceof RelayCommandError) {
        throw new HttpException(
          { code: error.code, message: error.message },
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw error;
    }
  }

  @Get()
  @RequirePermissions('stores:read')
  @ApiOperation({ summary: 'List Stores with platform/state filters.' })
  list(@Query() query: ListStoresQueryDto) {
    return this.stores.list({
      platform: query.platform,
      connectionState: query.connectionState,
    });
  }

  @Delete(':id')
  @RequirePermissions('stores:delete')
  @ApiOperation({ summary: 'Delete an order-less store (destructive, audited).' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.stores.remove(id, user.id);
    return { ok: true };
  }

  @Get(':id')
  @RequirePermissions('stores:read')
  @ApiOperation({ summary: 'Get a Store.' })
  get(@Param('id') id: string) {
    return this.stores.get(id);
  }

  @Patch(':id')
  @RequirePermissions('stores:configure')
  @ApiOperation({ summary: 'Update display name and platform settings.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStoreDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stores.update(id, dto, user.id);
  }

  @Post(':id/pause')
  @RequirePermissions('stores:pause')
  @ApiOperation({ summary: 'Pause imports (pending queue content is preserved).' })
  pause(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.stores.setConnectionState(id, 'paused', user.id);
  }

  @Post(':id/resume')
  @RequirePermissions('stores:resume')
  @ApiOperation({ summary: 'Resume imports.' })
  resume(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.stores.setConnectionState(id, 'connected', user.id);
  }

  @Post(':id/synchronize')
  @RequirePermissions('stores:synchronize')
  @ApiOperation({
    summary: 'Run one import pass against the Store platform (relay or simulated).',
  })
  async synchronize(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const store = await this.stores.get(id);
    // §25: a paused store prevents new merges; resume before synchronizing.
    if (store.connectionState === 'paused') {
      throw new ConflictException({
        code: 'STORE_PAUSED',
        message: 'Store is paused; resume it before synchronizing.',
      });
    }
    const adapter = this.adapterFor(store);
    try {
      const listings: ExternalListing[] = await adapter.fetchListings();
      const orders: ExternalOrder[] = await adapter.fetchOrders();
      const summary = await this.sync.runStoreSync(store, listings, orders);
      await this.stores.markSynced(id, null);
      void user;
      return { ok: true, summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.stores.markSynced(id, { message, at: new Date().toISOString() });
      if (error instanceof RelayCommandError) {
        throw new HttpException(
          { code: error.code, message: error.message },
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw error;
    }
  }
}
