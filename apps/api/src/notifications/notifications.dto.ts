import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LABEL_ORDER, NOTIFICATION_EVENTS, type Label } from '@md-wiki/domain';
import { labelCounts } from '../wiki/read.dto.js';

/** DTOs of system-logic §7.7.9. */

const timestamp = { type: String, format: 'date-time' } as const;
const nullableString = { type: String, nullable: true } as const;
const integer = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : (value as unknown);
const nullToUndefined = ({ value }: TransformFnParams): unknown =>
  value === null ? undefined : (value as unknown);
const FOLLOW_REASONS = ['manual', 'attested', 'contributed'] as const;
const CHANNELS = ['wiki', 'wiki_and_daily_email'] as const;
const NOTICE_ACTIONS = ['read_section', 'see_affected', 'check_again', 'see_outcome'] as const;

// ---- inputs -------------------------------------------------------------------------------

export class PageListInput {
  @IsOptional() @Transform(integer) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(80) cursor?: string;
}
export class FollowInput {
  @ApiProperty({ type: String }) @IsString() @MaxLength(200) path!: string;
  @ApiPropertyOptional({ ...nullableString, description: 'Section anchor; omit to follow the page' })
  @IsOptional()
  @Transform(nullToUndefined)
  @IsString()
  @MaxLength(200)
  anchor?: string;
  @ApiPropertyOptional({ type: Boolean, description: 'true mutes, false unmutes' })
  @IsOptional()
  @IsBoolean()
  muted?: boolean;
}
export class UnfollowInput {
  @IsString() @MaxLength(200) path!: string;
  @IsOptional() @IsString() @MaxLength(200) anchor?: string;
}
export class NotificationListInput extends PageListInput {
  @IsOptional() @IsIn(['true', 'false']) unread?: 'true' | 'false';
}
export class MarkReadInput {
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 100 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids?: string[];
  @ApiPropertyOptional({ type: Boolean, enum: [true] })
  @IsOptional()
  @IsIn([true])
  all?: true;
}
class PrefEventsDto {
  @ApiProperty({ type: Boolean }) @IsBoolean() section_recheck!: boolean;
  @ApiProperty({ type: Boolean }) @IsBoolean() section_edited!: boolean;
  @ApiProperty({ type: Boolean }) @IsBoolean() report_outcome!: boolean;
  @ApiProperty({ type: Boolean }) @IsBoolean() weekly_summary!: boolean;
}
export class NotificationPrefsDto {
  @ApiProperty({ type: PrefEventsDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PrefEventsDto)
  events!: PrefEventsDto;
  @ApiProperty({ enum: CHANNELS }) @IsIn(CHANNELS) channel!: (typeof CHANNELS)[number];
}

// ---- responses ----------------------------------------------------------------------------

class PageLabelDto {
  @ApiProperty({ enum: LABEL_ORDER }) label!: Label;
  @ApiProperty(labelCounts) spread!: Record<Label, number>;
}
export class FollowDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty(nullableString) anchor!: string | null;
  @ApiProperty({ enum: FOLLOW_REASONS }) reason!: (typeof FOLLOW_REASONS)[number];
  @ApiProperty({ type: Boolean }) muted!: boolean;
  @ApiProperty(timestamp) createdAt!: string;
}
class LastChangeDto {
  @ApiProperty({ type: String }) versionLabel!: string;
  @ApiProperty(timestamp) at!: string;
  @ApiProperty(nullableString) summary!: string | null;
}
class SectionRefDto {
  @ApiProperty({ type: String }) anchor!: string;
  @ApiProperty({ type: String }) title!: string;
}
export class FollowedPageDto extends FollowDto {
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty({ type: PageLabelDto }) pageLabel!: PageLabelDto;
  @ApiProperty({ type: LastChangeDto }) lastChange!: LastChangeDto;
  @ApiProperty({ type: [SectionRefDto] }) checkAgain!: SectionRefDto[];
}
export class FollowedPagesDto {
  @ApiProperty({ type: [FollowedPageDto] }) items!: FollowedPageDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
}
export class NotificationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: NOTIFICATION_EVENTS }) event!: (typeof NOTIFICATION_EVENTS)[number];
  @ApiProperty(nullableString) path!: string | null;
  @ApiProperty(nullableString) pageTitle!: string | null;
  @ApiProperty(nullableString) anchor!: string | null;
  @ApiProperty({ type: String }) text!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) data!: object;
  @ApiProperty(timestamp) createdAt!: string;
  @ApiProperty({ ...timestamp, nullable: true }) readAt!: string | null;
}
export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto] }) items!: NotificationDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
  @ApiProperty({ type: 'integer' }) unread!: number;
}
export class UnreadDto {
  @ApiProperty({ type: 'integer' }) unread!: number;
}
export class NoticeDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: NOTIFICATION_EVENTS }) event!: (typeof NOTIFICATION_EVENTS)[number];
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty(nullableString) anchor!: string | null;
  @ApiProperty({ type: String }) text!: string;
  @ApiProperty({ enum: NOTICE_ACTIONS }) action!: (typeof NOTICE_ACTIONS)[number];
  @ApiProperty(timestamp) createdAt!: string;
}
export class NoticeListDto {
  @ApiProperty({ type: [NoticeDto] }) items!: NoticeDto[];
}
