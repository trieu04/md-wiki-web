import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Role, Scope, UserKind, type User } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayUnique,
  IsBoolean,
  isRFC3339,
  ValidateBy,
  IsEmail,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const provided = (_: unknown, v: unknown) => v !== undefined;
const uuid = { type: String, format: 'uuid' };
const timestamp = { type: String, format: 'date-time' };

export class LoginInput {
  @ApiProperty({ type: String, format: 'email' }) @IsEmail() email!: string;
  @ApiProperty({ type: String, writeOnly: true }) @IsString() @MinLength(1) password!: string;
}
export class CreateUserInput {
  @ApiProperty({ type: String, format: 'email' }) @IsEmail() email!: string;
  @ApiProperty({ type: String }) @IsString() @Matches(/\S/) name!: string;
  @ApiProperty({ enum: Role, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(Role, { each: true })
  roles!: Role[];
  @ApiProperty({ ...uuid, nullable: true }) @ValidateIf((_, v) => v !== null) @IsUUID() teamId!:
    string | null;
  @ApiPropertyOptional({ type: String, writeOnly: true })
  @ValidateIf(provided)
  @IsString()
  @MinLength(1)
  password?: string;
}
export class UpdateUserInput extends PartialType(CreateUserInput, { skipNullProperties: false }) {
  @ApiPropertyOptional({ type: Boolean }) @ValidateIf(provided) @IsBoolean() disabled?: boolean;
}
export class TeamInput {
  @ApiProperty({ type: String }) @IsString() @Matches(/\S/) name!: string;
}
// RFC 3339 syntax alone permits February 30 and precision that Date would discard.
function representableTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || !isRFC3339(value)) return false;
  const instant = new Date(value);
  const day = value.slice(0, 10);
  return (
    instant.getUTCFullYear() >= 0 &&
    instant.getUTCFullYear() <= 9999 &&
    // A space separator can send Date.parse down its legacy two-digit-year path.
    instant.getTime() === Date.parse(value.replace(' ', 'T')) &&
    new Date(day).toISOString().startsWith(day + 'T') &&
    value.slice(17, 19) !== '60' &&
    !/\.\d{3}\d*[1-9]/.test(value)
  );
}
export class TokenInput {
  @ApiProperty(uuid) @IsUUID() userId!: string;
  @ApiProperty({ type: String }) @IsString() @Matches(/\S/) name!: string;
  @ApiProperty({ enum: Scope, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(Scope, { each: true })
  scopes!: Scope[];
  @ApiPropertyOptional(timestamp)
  @ValidateIf(provided)
  @ValidateBy({
    name: 'isRepresentableTimestamp',
    validator: {
      validate: representableTimestamp,
      defaultMessage: () =>
        'expiresAt must be a valid RFC 3339 timestamp representable in milliseconds',
    },
  })
  expiresAt?: string;
}
export class PageInput {
  @ValidateIf(provided) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ValidateIf(provided) @IsUUID() cursor?: string;
}
export class IdInput {
  @IsUUID() id!: string;
}

export class MeDto {
  @ApiProperty(uuid) id!: string;
  @ApiProperty({ type: String }) email!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: UserKind }) kind!: UserKind;
  @ApiProperty({ enum: Role, isArray: true }) roles!: Role[];
  @ApiProperty({ ...uuid, nullable: true }) teamId!: string | null;
}
export function me({ id, email, name, kind, roles, teamId }: User) {
  return { id, email, name, kind, roles, teamId };
}
export class LoginDto {
  @ApiProperty({ type: MeDto }) user!: MeDto;
  @ApiProperty({ type: String }) csrfToken!: string;
}
export class SessionDto {
  @ApiProperty({ type: MeDto, nullable: true }) user!: MeDto | null;
  @ApiProperty({ type: String, nullable: true }) csrfToken!: string | null;
}
export class UserDto extends MeDto {
  @ApiProperty({ type: Boolean }) disabled!: boolean;
  @ApiProperty(timestamp) createdAt!: Date;
}
export function userDto(u: User) {
  return { ...me(u), disabled: u.disabledAt !== null, createdAt: u.createdAt };
}
export class TeamDto {
  @ApiProperty(uuid) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) slug!: string;
}
export class ApiTokenDto {
  @ApiProperty(uuid) id!: string;
  @ApiProperty(uuid) userId!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) prefix!: string;
  @ApiProperty({ enum: Scope, isArray: true }) scopes!: Scope[];
  @ApiProperty(timestamp) createdAt!: Date;
  @ApiProperty({ ...timestamp, nullable: true }) expiresAt!: Date | null;
  @ApiProperty({ ...timestamp, nullable: true }) lastUsedAt!: Date | null;
  @ApiProperty({ ...timestamp, nullable: true }) revokedAt!: Date | null;
}
export class CreatedTokenDto extends ApiTokenDto {
  @ApiProperty({ type: String }) token!: string;
}
class PageDto {
  @ApiProperty({ ...uuid, nullable: true }) nextCursor!: string | null;
}
export class UsersDto extends PageDto {
  @ApiProperty({ type: [UserDto] }) items!: UserDto[];
}
export class TeamsDto extends PageDto {
  @ApiProperty({ type: [TeamDto] }) items!: TeamDto[];
}
export class TokensDto extends PageDto {
  @ApiProperty({ type: [ApiTokenDto] }) items!: ApiTokenDto[];
}
export class ReindexDto {
  @ApiProperty({ type: 'integer' }) scanned!: number;
  @ApiProperty({ type: 'integer' }) changed!: number;
  @ApiProperty({ type: 'integer' }) durationMs!: number;
}
