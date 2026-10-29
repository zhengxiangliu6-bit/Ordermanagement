import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  Min,
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
  @ApiPropertyOptional({ description: 'Ordering-stage note.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

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

/** M7b packing step: weight and box dimensions with selectable units. */
export const WEIGHT_UNITS = ['g', 'kg'] as const;
export const DIMENSION_UNITS = ['cm', 'mm', 'in'] as const;

export class PackShipmentDto {
  @ApiProperty({ example: 350, description: 'Weight value in the chosen unit (required, > 0).' })
  @IsNumber()
  @Min(0.01)
  weightValue!: number;

  @ApiProperty({ enum: WEIGHT_UNITS })
  @IsIn(WEIGHT_UNITS)
  weightUnit!: (typeof WEIGHT_UNITS)[number];

  @ApiPropertyOptional({ description: 'Packing-stage note.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({ example: 30, description: 'Required, > 0.' })
  @IsNumber()
  @Min(0.01)
  lengthValue!: number;

  @ApiProperty({ example: 20, description: 'Required, > 0.' })
  @IsNumber()
  @Min(0.01)
  widthValue!: number;

  @ApiProperty({ example: 10, description: 'Required, > 0.' })
  @IsNumber()
  @Min(0.01)
  heightValue!: number;

  @ApiProperty({ enum: DIMENSION_UNITS })
  @IsIn(DIMENSION_UNITS)
  dimensionUnit!: (typeof DIMENSION_UNITS)[number];
}

export class InspectShipmentDto {
  @ApiPropertyOptional({ description: 'Inspection-stage note.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class TailTrackingDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  tailTrackingNumber!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tailCarrier?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  tailTrackingUrl?: string;

  @ApiPropertyOptional({ description: 'Tail-stage note.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Problem-item types (M7c decision 10). */
export const PROBLEM_TYPES = [
  'pending_pickup',
  'returning',
  'address',
  'damaged',
  'missing',
  'other',
] as const;

export const PROBLEM_SOURCES = ['work', 'detail'] as const;

export class CreateProblemDto {
  @ApiProperty({ enum: PROBLEM_TYPES })
  @IsIn(PROBLEM_TYPES)
  type!: (typeof PROBLEM_TYPES)[number];

  @ApiPropertyOptional({ enum: PROBLEM_SOURCES, description: 'Where the problem was reported from.' })
  @IsOptional()
  @IsIn(PROBLEM_SOURCES)
  source?: (typeof PROBLEM_SOURCES)[number];

  @ApiProperty({ description: 'What the problem is; shown to the reviewer.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

export const PROBLEM_RESOLUTIONS = ['cancel', 'restart', 'copy'] as const;

export const PROBLEM_RETURN_STAGES = ['packing', 'ordering', 'inspection'] as const;

export class ResolveProblemDto {
  @ApiProperty({ enum: PROBLEM_RESOLUTIONS })
  @IsIn(PROBLEM_RESOLUTIONS)
  resolution!: (typeof PROBLEM_RESOLUTIONS)[number];

  @ApiPropertyOptional({
    enum: PROBLEM_RETURN_STAGES,
    description: 'Stage to return the order to when resolution is restart.',
  })
  @IsOptional()
  @IsIn(PROBLEM_RETURN_STAGES)
  returnStage?: (typeof PROBLEM_RETURN_STAGES)[number];

  @ApiPropertyOptional({ description: 'Resolution note.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Packing gift / extra item (linked to an item variant for later stock). */
export class CreateAddOnDto {
  @ApiPropertyOptional({ description: 'Item variant id (preferred; drives future stock).' })
  @IsOptional()
  @IsUUID()
  itemVariantId?: string;

  @ApiProperty({ description: 'Display title (auto-filled from the variant by the UI).' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

}
