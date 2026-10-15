import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Allowed sync policy modes (§12.8), shared by settings and Store overrides. */
export const SYNC_POLICY_VALUES = [
  'immediate',
  'scheduled',
  'review_then_immediate',
  'review_then_scheduled',
] as const;

export class OutboundScheduleConfigDto {
  @ApiPropertyOptional({ example: '17:30', description: 'Daily fixed send time (HH:mm). Wins over the window when set.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(5)
  fixedTime?: string | null;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(5)
  windowStart?: string | null;

  @ApiPropertyOptional({ example: '18:00' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(5)
  windowEnd?: string | null;

  @ApiPropertyOptional({ type: [Number], example: [1, 2, 3, 4, 5], description: '0=Sunday .. 6=Saturday' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsArray()
  daysOfWeek?: number[] | null;

  @ApiPropertyOptional({ description: 'Restrict to Mon-Fri (holiday calendars out of first release).' })
  @IsOptional()
  @IsBoolean()
  workdaysOnly?: boolean;
}

export class ShippingSettingsPatchDto {
  @ApiPropertyOptional({ example: 'Asia/Shanghai', description: 'The one system-wide External Timezone (IANA name).' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  externalTimezone?: string;

  @ApiPropertyOptional({ enum: SYNC_POLICY_VALUES })
  @IsOptional()
  @IsIn(SYNC_POLICY_VALUES)
  initialSyncPolicy?: (typeof SYNC_POLICY_VALUES)[number];

  @ApiPropertyOptional({ enum: SYNC_POLICY_VALUES })
  @IsOptional()
  @IsIn(SYNC_POLICY_VALUES)
  revisionSyncPolicy?: (typeof SYNC_POLICY_VALUES)[number];

  @ApiPropertyOptional({ type: OutboundScheduleConfigDto })
  @IsOptional()
  schedule?: OutboundScheduleConfigDto;

  @ApiPropertyOptional({
    description:
      'Global-default own-site tracking URL template ({number} placeholder). Null clears it.',
    example: 'https://track.attaky.com/{number}',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  ownSiteTrackingUrlTemplate?: string | null;
}

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

export class RecognizeTrackingDto {
  @ApiProperty({ example: 'SF1234567890123' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  trackingNumber!: string;
}

export class ShipmentRevisionDto {
  @ApiProperty({ description: 'Required human reason for the correction (§12.12).' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ description: 'Replacement tracking number; defaults to the current one.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  trackingNumber?: string;

  @ApiPropertyOptional({ description: 'Replacement carrier; defaults to the current one.' })
  @IsOptional()
  @IsUUID()
  carrierId?: string;
}

export class ShipmentPreviewDto {
  @ApiProperty({ example: 'SF1234567890123' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  trackingNumber!: string;

  @ApiProperty()
  @IsUUID()
  carrierId!: string;
}

export class ShipmentEntryDto {
  @ApiProperty({ example: 'SF1234567890123' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  trackingNumber!: string;

  @ApiProperty({ description: 'Chosen carrier: auto match, ambiguity resolution, or manual selection.' })
  @IsUUID()
  carrierId!: string;

  @ApiPropertyOptional({ description: 'Actual dispatch time; defaults to entry time.' })
  @IsOptional()
  dispatchedAt?: string;
}
