import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateItemDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'English name (Canada warehouse display).' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Image URLs.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}

export class UpdateItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'English name (Canada warehouse display).' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Image URLs.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}

export class CreateItemVariantDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'English name (Canada warehouse display).' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;

  @ApiPropertyOptional({ type: Object, additionalProperties: true })
  @IsOptional()
  @IsObject()
  optionValues?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String], description: 'Image URLs.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}

export class VariantBatchAxisDto {
  @ApiProperty({ example: 'Color' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: ['Ice', 'Dawn', 'Powder'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  values!: string[];
}

export class CreateItemVariantsBatchDto {
  @ApiProperty({ type: [VariantBatchAxisDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  axes!: VariantBatchAxisDto[];
}

export class UpdateItemVariantDto extends PartialType(CreateItemVariantDto) {}

export class ListItemsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  // Query params arrive as strings; a plain Boolean('false') would be true.
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  archived?: boolean;

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
