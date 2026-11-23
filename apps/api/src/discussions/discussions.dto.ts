import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CLOSE_OUTCOMES,
  DISPUTE_ACTIONS,
  DISPUTE_RESOLUTIONS,
  ENTRY_KINDS,
  TOPIC_FILTERS,
  TOPIC_STATUSES,
} from '@md-wiki/domain';
import { UserRefDto } from '../review/review.dto.js';

/** DTOs of system-logic §7.5.4. */

const timestamp = { type: String, format: 'date-time' } as const;
const nullableString = { type: String, nullable: true } as const;
const HASH = /^[a-f0-9]{64}$/;
const NON_BLANK = /\S/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TITLE_LIMIT = 120;
export const BODY_LIMIT = 20000;
const MAX_LIMIT = 100;
const trimmed = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);
const integer = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : (value as unknown);
const nullToUndefined = ({ value }: TransformFnParams): unknown =>
  value === null ? undefined : (value as unknown);
type TopicStatus = (typeof TOPIC_STATUSES)[number];
type CloseOutcome = (typeof CLOSE_OUTCOMES)[number];

// ---- inputs -------------------------------------------------------------------------------

export class TopicIdInput {
  @IsUUID() id!: string;
}
export class TopicListInput {
  @IsOptional() @IsIn(TOPIC_FILTERS) filter?: (typeof TOPIC_FILTERS)[number];
  @IsOptional() @IsString() @MaxLength(200) path?: string;
  @IsOptional() @IsString() @MaxLength(200) anchor?: string;
  @IsOptional() @IsString() @Matches(SLUG) @MaxLength(80) proposal?: string;
  @IsOptional() @Transform(integer) @IsInt() @Min(1) @Max(MAX_LIMIT) limit?: number;
  @IsOptional() @IsString() cursor?: string;
}
export class EntryPageInput {
  @IsOptional() @Transform(integer) @IsInt() @Min(1) @Max(MAX_LIMIT) limit?: number;
  @IsOptional() @IsString() @Matches(/^\d{1,9}$/) cursor?: string;
}
const mentions = () =>
  ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: 20,
    description: 'User ids to mention; they become participants',
  });
export class TopicCreateInput {
  @ApiProperty({ type: String, description: 'Wiki path of an indexed page' })
  @IsString()
  @MaxLength(200)
  path!: string;
  @ApiPropertyOptional({ ...nullableString, description: 'Section anchor in the current version' })
  @IsOptional()
  @Transform(nullToUndefined)
  @IsString()
  @MaxLength(200)
  anchor?: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: TITLE_LIMIT })
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(TITLE_LIMIT)
  title!: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: BODY_LIMIT })
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(BODY_LIMIT)
  body!: string;
  @mentions()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  mentions?: string[];
}
export class CommentInput {
  @ApiProperty({ type: String, minLength: 1, maxLength: BODY_LIMIT })
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(BODY_LIMIT)
  body!: string;
  @ApiPropertyOptional({ enum: ['comment', 'agreement'], default: 'comment' })
  @IsOptional()
  @IsIn(['comment', 'agreement'])
  kind?: 'comment' | 'agreement';
  @ApiPropertyOptional({ type: 'integer', minimum: 1, description: 'The entry this replies to' })
  @IsOptional()
  @IsInt()
  @Min(1)
  parentSeq?: number;
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    description: 'Required for kind agreement: the entry agreed with',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  agreesWith?: number;
  @mentions()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  mentions?: string[];
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    description: 'The topic version the caller read; required on a proposal topic',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
export class TopicCloseInput {
  @ApiProperty({ enum: CLOSE_OUTCOMES }) @IsIn(CLOSE_OUTCOMES) outcome!: CloseOutcome;
  @ApiProperty({ type: String, minLength: 1, maxLength: BODY_LIMIT, description: 'Rationale' })
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(BODY_LIMIT)
  reason!: string;
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    description: 'Required on a proposal topic',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
export class TopicReopenInput {
  @ApiProperty({ type: String, minLength: 1, maxLength: BODY_LIMIT })
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(BODY_LIMIT)
  reason!: string;
  @ApiPropertyOptional({ type: 'integer', minimum: 1, description: 'Required on a proposal topic' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
export class ProposalDiscussionInput {
  @ApiProperty({ type: String, pattern: HASH.source, description: 'The bundle the caller read' })
  @IsString()
  @Matches(HASH)
  bundleHash!: string;
  @ApiPropertyOptional({ type: String, maxLength: TITLE_LIMIT })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(TITLE_LIMIT)
  title?: string;
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: BODY_LIMIT,
    description: 'What is in question',
  })
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(BODY_LIMIT)
  body!: string;
  @ApiPropertyOptional({ ...nullableString, description: "Defaults to the proposal's section" })
  @IsOptional()
  @Transform(nullToUndefined)
  @IsString()
  @MaxLength(200)
  anchor?: string;
  @mentions()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  mentions?: string[];
}
export class DisputeInput {
  @ApiProperty({ type: String, pattern: HASH.source })
  @IsString()
  @Matches(HASH)
  bundleHash!: string;
  @ApiProperty({ type: 'integer', minimum: 0, description: 'The dispute version the caller read' })
  @IsInt()
  @Min(0)
  disputeVersion!: number;
  @ApiProperty({ enum: DISPUTE_ACTIONS })
  @IsIn(DISPUTE_ACTIONS)
  action!: (typeof DISPUTE_ACTIONS)[number];
  @ApiProperty({ type: String, minLength: 1, maxLength: BODY_LIMIT })
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(BODY_LIMIT)
  reason!: string;
  @ApiPropertyOptional({ enum: DISPUTE_RESOLUTIONS, description: 'Required for resolve only' })
  @IsOptional()
  @IsString()
  resolutionKind?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 50, description: 'Related proposal slugs' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  relatedSlugs?: string[];
}

// ---- outputs ------------------------------------------------------------------------------

export class TopicEntryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'integer' }) seq!: number;
  @ApiProperty({ enum: ENTRY_KINDS }) kind!: (typeof ENTRY_KINDS)[number];
  @ApiProperty({ type: UserRefDto }) author!: UserRefDto;
  @ApiProperty({ type: String }) body!: string;
  @ApiProperty({ type: 'integer', nullable: true }) parentSeq!: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) agreesWith!: number | null;
  @ApiProperty({ enum: CLOSE_OUTCOMES, nullable: true }) outcome!: CloseOutcome | null;
  @ApiProperty({ type: [UserRefDto] }) mentions!: UserRefDto[];
  @ApiProperty(timestamp) createdAt!: string;
}
export class TopicProposalDto {
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ enum: ['pending', 'approved', 'published', 'rejected', 'stale'] })
  state!: 'pending' | 'approved' | 'published' | 'rejected' | 'stale';
  @ApiProperty({ type: Boolean, description: 'This topic currently blocks approval' })
  holds!: boolean;
}
export class TopicListItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty(nullableString) anchor!: string | null;
  @ApiProperty(nullableString) sectionTitle!: string | null;
  @ApiProperty({ enum: TOPIC_STATUSES }) status!: TopicStatus;
  @ApiProperty({ type: TopicProposalDto, nullable: true }) proposal!: TopicProposalDto | null;
  @ApiProperty({ type: UserRefDto }) author!: UserRefDto;
  @ApiProperty({ type: 'integer', description: 'Entries after the opening one' }) replies!: number;
  @ApiProperty({ type: 'integer' }) version!: number;
  @ApiProperty(timestamp) createdAt!: string;
  @ApiProperty(timestamp) updatedAt!: string;
}
class TopicCountsDto {
  @ApiProperty({ type: 'integer' }) open!: number;
  @ApiProperty({ type: 'integer' }) mine!: number;
  @ApiProperty({ type: 'integer' }) closed!: number;
  @ApiProperty({ type: 'integer' }) all!: number;
}
export class TopicListDto {
  @ApiProperty({ type: [TopicListItemDto] }) items!: TopicListItemDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
  @ApiProperty({ type: TopicCountsDto }) counts!: TopicCountsDto;
}
class TopicClosedDto {
  @ApiProperty({ type: UserRefDto }) by!: UserRefDto;
  @ApiProperty({ enum: CLOSE_OUTCOMES }) outcome!: CloseOutcome;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty(timestamp) at!: string;
}
class TopicCanDto {
  @ApiProperty({ type: Boolean }) comment!: boolean;
  @ApiProperty({ type: Boolean }) close!: boolean;
  @ApiProperty({ type: Boolean }) reopen!: boolean;
}
export class TopicDetailDto extends TopicListItemDto {
  @ApiProperty({ ...nullableString, description: 'Page version the topic was opened on' })
  versionLabel!: string | null;
  @ApiProperty(nullableString) bundleHash!: string | null;
  @ApiProperty({ type: [UserRefDto] }) participants!: UserRefDto[];
  @ApiProperty({ type: TopicClosedDto, nullable: true }) closed!: TopicClosedDto | null;
  @ApiProperty({ type: [TopicEntryDto] }) entries!: TopicEntryDto[];
  @ApiProperty({ type: TopicCanDto }) can!: TopicCanDto;
}
export class TopicEntryPageDto {
  @ApiProperty({ type: [TopicEntryDto] }) items!: TopicEntryDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
}
export class DisputeEventDto {
  @ApiProperty({ type: 'integer' }) seq!: number;
  @ApiProperty({ enum: DISPUTE_ACTIONS }) action!: (typeof DISPUTE_ACTIONS)[number];
  @ApiProperty({ type: UserRefDto }) actor!: UserRefDto;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ enum: DISPUTE_RESOLUTIONS, nullable: true })
  resolutionKind!: (typeof DISPUTE_RESOLUTIONS)[number] | null;
  @ApiProperty({ type: [String] }) relatedSlugs!: string[];
  @ApiProperty(timestamp) createdAt!: string;
}
export class DisputeLogDto {
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) bundleHash!: string;
  @ApiProperty({ type: 'integer' }) disputeVersion!: number;
  @ApiProperty({ type: Boolean }) disputeOpen!: boolean;
  @ApiProperty({ type: [DisputeEventDto] }) events!: DisputeEventDto[];
}
export class ProposalDiscussionDto {
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) bundleHash!: string;
  @ApiProperty({ enum: ['pending', 'approved', 'published', 'rejected', 'stale'] })
  state!: 'pending' | 'approved' | 'published' | 'rejected' | 'stale';
  @ApiProperty({ type: 'integer' }) discussionVersion!: number;
  @ApiProperty({ type: 'integer' }) disputeVersion!: number;
  @ApiProperty({ type: Boolean }) held!: boolean;
  @ApiProperty({ type: Boolean }) disputeOpen!: boolean;
  @ApiProperty({ type: Boolean, description: 'held or disputeOpen: approval is blocked' })
  disputed!: boolean;
  @ApiProperty({ type: TopicDetailDto, nullable: true }) topic!: TopicDetailDto | null;
  @ApiProperty({ type: DisputeLogDto }) disputes!: DisputeLogDto;
}
