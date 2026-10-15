import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const STORE_PLATFORMS = ['shopify', 'etsy'] as const;
export type StorePlatform = (typeof STORE_PLATFORMS)[number];

export class CreateStoreDto {
  @ApiProperty({ enum: STORE_PLATFORMS })
  @IsIn(STORE_PLATFORMS as unknown as string[])
  platform!: StorePlatform;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalShopId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalShopName?: string;
}

export class ConnectStoreDto {
  @ApiPropertyOptional({
    description: 'Earliest order date to import (ISO 8601). Defaults to all available.',
  })
  @IsOptional()
  @IsString()
  importStartDate?: string;
}

export class ListStoresQueryDto {
  @ApiPropertyOptional({ enum: ['shopify', 'etsy'] })
  @IsOptional()
  @IsIn(['shopify', 'etsy'])
  platform?: string;

  @ApiPropertyOptional({ enum: ['connected', 'paused', 'disconnected'] })
  @IsOptional()
  @IsIn(['connected', 'paused', 'disconnected'])
  connectionState?: string;
}

export const SYNC_POLICY_VALUES = [
  'immediate',
  'scheduled',
  'review_then_immediate',
  'review_then_scheduled',
] as const;

export class StorePolicyOverrideDto {
  @ApiPropertyOptional({ enum: SYNC_POLICY_VALUES })
  @IsOptional()
  @IsIn(SYNC_POLICY_VALUES)
  initial?: (typeof SYNC_POLICY_VALUES)[number];

  @ApiPropertyOptional({ enum: SYNC_POLICY_VALUES })
  @IsOptional()
  @IsIn(SYNC_POLICY_VALUES)
  revision?: (typeof SYNC_POLICY_VALUES)[number];
}

export class UpdateStoreDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Per-store outbound sync policy overrides (§12.8).',
    type: StorePolicyOverrideDto,
  })
  @IsOptional()
  @IsObject()
  shippingPolicyOverride?: Record<string, unknown>;
}
