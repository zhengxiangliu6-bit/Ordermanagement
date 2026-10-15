import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleKeys?: string[];
}

export class SetRolesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleKeys!: string[];
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current (or one-time temporary) password.' })
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class ListUsersQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'disabled', 'must-change'] })
  @IsOptional()
  @IsIn(['active', 'disabled', 'must-change'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  roleKey?: string;
}

export class SetActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export const USER_ACTIONS = ['disable', 'enable', 'reset-password'] as const;
export class UserActionDto {
  @ApiProperty({ enum: USER_ACTIONS })
  @IsIn(USER_ACTIONS as unknown as string[])
  action!: (typeof USER_ACTIONS)[number];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
