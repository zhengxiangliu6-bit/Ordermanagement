import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class OrderLineInputDto {
  @ApiProperty({ minLength: 1, maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /** Linking a variant pins the applicable content version (§10.2). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  itemVariantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  listingVariantId?: string;
}

export class OrderCustomerInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;
}

export class CreateManualOrderDto {
  @ApiProperty({ type: [OrderLineInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines!: OrderLineInputDto[];

  @ApiPropertyOptional({ type: OrderCustomerInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderCustomerInputDto)
  customer?: OrderCustomerInputDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  buyerNote?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  giftInfo?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deliveryMethod?: string;
}

/** Internal revision input: a reason is mandatory (§11). */
export class ReviseOrderDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({ type: OrderCustomerInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderCustomerInputDto)
  customer?: OrderCustomerInputDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  buyerNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deliveryMethod?: string;
}

export class CreateOrderLinkDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  relatedOrderId!: string;
}

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ enum: ['external', 'manual'] })
  @IsOptional()
  @IsIn(['external', 'manual'])
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  storeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
