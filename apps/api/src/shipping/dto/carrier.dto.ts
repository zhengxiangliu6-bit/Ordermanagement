import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CarrierNormalizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  stripSpaces?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  uppercase?: boolean;
}

export class CarrierRecognitionDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  regexes!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CarrierNormalizationDto)
  normalization?: CarrierNormalizationDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class AttakyTransformRuleDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  pattern!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  replacement!: string;
}

export class AttakyTransformDto {
  @ApiProperty({ type: [AttakyTransformRuleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttakyTransformRuleDto)
  rules!: AttakyTransformRuleDto[];

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class CarrierInputDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  key!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty()
  @IsObject()
  @ValidateNested()
  @Type(() => CarrierRecognitionDto)
  recognition!: CarrierRecognitionDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  trackingUrlTemplate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AttakyTransformDto)
  attakyTransform?: AttakyTransformDto | null;
}

export class CarrierPreviewDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  trackingNumber!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  carrierId?: string;
}

export class CarrierCollisionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  samples!: string[];
}
