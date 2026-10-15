import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  ExternalListing,
  ExternalOrder,
} from '../platform-adapter';

export class InjectListingDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  externalListingId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class InjectOrderLineDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  listingExternalId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  variantExternalId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  quantity?: number;
}

export class InjectOrderDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  externalOrderId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  displayNumber!: string;

  @ApiProperty({ type: [InjectOrderLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InjectOrderLineDto)
  lines!: InjectOrderLineDto[];

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  customerName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerEmail?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  customerExtra?: Record<string, unknown>;
}

/** Listing update event: patches content and bumps the source timestamp. */
export class ListingUpdateEventDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  externalListingId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}

export function listingEventToListing(dto: ListingUpdateEventDto): ExternalListing {
  return {
    externalListingId: dto.externalListingId,
    status: dto.status ?? 'active',
    title: dto.title ?? `Listing ${dto.externalListingId}`,
    description: dto.description,
    sourceUpdatedAt: new Date().toISOString(),
    variants: [],
  };
}

export function injectDtoToOrder(dto: InjectOrderDto): ExternalOrder {
  return {
    externalOrderId: dto.externalOrderId,
    displayNumber: dto.displayNumber,
    statusRaw: { financialStatus: 'paid' },
    customer: {
      name: dto.customerName,
      email: dto.customerEmail,
      ...(dto.customerExtra ?? {}),
    },
    sourceUpdatedAt: new Date().toISOString(),
    lines: dto.lines.map((line, index) => ({
      externalLineId: `${dto.externalOrderId}-L${index + 1}`,
      title: line.title,
      quantity: line.quantity ?? 1,
      listingExternalId: line.listingExternalId,
      variantExternalId: line.variantExternalId,
    })),
  };
}

export class OrderUpdateEventDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  externalOrderId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  buyerNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;
}
