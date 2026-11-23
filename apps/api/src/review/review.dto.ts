import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ProposalDto } from '../contributions/contributions.dto.js';
import { EVENT_TYPES, type EventType } from '../events/events.service.js';

const timestamp = { type: String, format: 'date-time' } as const;
const nullableTimestamp = { type: String, format: 'date-time', nullable: true } as const;
const nullableString = { type: String, nullable: true } as const;
const HASH = /^[a-f0-9]{64}$/;
const NON_BLANK = /\S/;
const REASON_LIMIT = 4000;
const MAX_LIMIT = 100;
export const PHASES = [
  'prepared',
  'writing',
  'written',
  'done',
  'unknown',
  'stale',
  'not_written',
] as const;
export const TABS = ['open', 'stale', 'blocked', 'published', 'rejected', 'all'] as const;
const LIST_TABS = ['open', 'stale', 'blocked', 'published', 'rejected'] as const;
const STATES = ['pending', 'approved', 'published', 'rejected', 'stale'] as const;
const REVIEWER_KINDS = ['agent', 'person'] as const;
export const CONFLICT_OUTCOMES = ['keep_current', 'use_incoming', 'merge'] as const;
const RESOLUTION_OUTCOMES = ['written', 'not_written'] as const;
type Phase = (typeof PHASES)[number];
type ReviewerKind = (typeof REVIEWER_KINDS)[number];

const trimmed = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);
const integer = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : (value as unknown);

// ---- inputs -------------------------------------------------------------------------------

export class SlugInput {
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(80) slug!: string;
}
export class ProposalListInput {
  @IsOptional() @IsIn(TABS) tab?: (typeof TABS)[number];
  @IsOptional() @IsIn(STATES) state?: (typeof STATES)[number];
  @IsOptional() @IsString() @MaxLength(200) targetPath?: string;
  @IsOptional() @Transform(integer) @IsInt() @Min(1) @Max(MAX_LIMIT) limit?: number;
  @IsOptional() @IsString() cursor?: string;
}
export class DiffInput {
  @IsOptional() @IsIn(['base', 'current']) against?: 'base' | 'current';
}
export class DecisionInput {
  @ApiProperty({ type: Boolean }) @IsBoolean() approve!: boolean;
  @ApiProperty({ type: String, minLength: 1, maxLength: REASON_LIMIT })
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(REASON_LIMIT)
  reason!: string;
  @ApiProperty({ type: String, pattern: HASH.source })
  @IsString()
  @Matches(HASH)
  bundleHash!: string;
  @ApiProperty({ type: String, pattern: HASH.source })
  @IsString()
  @Matches(HASH)
  artifactHash!: string;
  @ApiProperty(timestamp) @IsString() @MaxLength(40) previewAt!: string;
  @ApiProperty({ type: 'integer', minimum: 0 }) @IsInt() @Min(0) discussionVersion!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) @IsInt() @Min(0) disputeVersion!: number;
}
export class WithdrawInput {
  @ApiPropertyOptional({ type: String, maxLength: REASON_LIMIT })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(REASON_LIMIT)
  reason?: string;
}
export class ConflictInput {
  @ApiProperty({ enum: CONFLICT_OUTCOMES })
  @IsIn(CONFLICT_OUTCOMES)
  outcome!: (typeof CONFLICT_OUTCOMES)[number];
  @ApiProperty({ type: String, minLength: 1, maxLength: REASON_LIMIT })
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(REASON_LIMIT)
  reason!: string;
  @ApiPropertyOptional({ type: String, description: 'The edited region (section or whole page)' })
  @IsOptional()
  @IsString()
  replacement?: string;
}
export class ResolutionInput {
  @ApiProperty({ enum: RESOLUTION_OUTCOMES })
  @IsIn(RESOLUTION_OUTCOMES)
  outcome!: (typeof RESOLUTION_OUTCOMES)[number];
  @ApiProperty({ type: String, minLength: 1, maxLength: REASON_LIMIT })
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(REASON_LIMIT)
  evidence!: string;
}
export class AuditInput {
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() @MaxLength(100) subjectType?: string;
  @IsOptional() @IsString() @MaxLength(200) subjectId?: string;
  @IsOptional() @IsString() @Matches(/^[0-9a-f-]{36}$/i) actorId?: string;
  @IsOptional() @Transform(integer) @IsInt() @Min(1) @Max(MAX_LIMIT) limit?: number;
  @IsOptional() @IsString() cursor?: string;
}

// ---- outputs ------------------------------------------------------------------------------

export class UserRefDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: ['human', 'agent'] }) kind!: 'human' | 'agent';
}
export class AssignmentDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: UserRefDto }) assignee!: UserRefDto;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty(nullableString) trigger!: string | null;
  @ApiProperty(timestamp) createdAt!: string;
}
export class DecisionDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: UserRefDto }) reviewer!: UserRefDto;
  @ApiProperty({ enum: REVIEWER_KINDS }) reviewerKind!: ReviewerKind;
  @ApiProperty({ type: Boolean }) approve!: boolean;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String }) bundleHash!: string;
  @ApiProperty({ type: String }) artifactHash!: string;
  @ApiProperty(timestamp) previewAt!: string;
  @ApiProperty({ type: 'integer' }) discussionVersion!: number;
  @ApiProperty({ type: 'integer' }) disputeVersion!: number;
  @ApiProperty(timestamp) createdAt!: string;
}
export class ResolutionDto {
  @ApiProperty({ enum: RESOLUTION_OUTCOMES }) outcome!: (typeof RESOLUTION_OUTCOMES)[number];
  @ApiProperty({ type: String }) evidence!: string;
  @ApiProperty({ type: UserRefDto }) actor!: UserRefDto;
  @ApiProperty(nullableString) diskSha256!: string | null;
  @ApiProperty(timestamp) createdAt!: string;
}
export class PublicationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'integer' }) attempt!: number;
  @ApiProperty({ enum: PHASES, enumName: 'PublicationPhase' }) phase!: Phase;
  @ApiProperty({ type: Boolean }) auto!: boolean;
  @ApiProperty({ type: UserRefDto, nullable: true }) actor!: UserRefDto | null;
  @ApiProperty(nullableString) baseSha256!: string | null;
  @ApiProperty({ type: String }) artifactHash!: string;
  @ApiProperty(nullableString) receiptId!: string | null;
  @ApiProperty(nullableString) error!: string | null;
  @ApiProperty(nullableString) versionLabel!: string | null;
  @ApiProperty(timestamp) startedAt!: string;
  @ApiProperty(nullableTimestamp) writtenAt!: string | null;
  @ApiProperty(nullableTimestamp) finishedAt!: string | null;
  @ApiProperty(timestamp) updatedAt!: string;
  @ApiProperty({ type: ResolutionDto, nullable: true }) resolution!: ResolutionDto | null;
}
class ListDecisionDto {
  @ApiProperty({ type: Boolean }) approve!: boolean;
  @ApiProperty({ type: UserRefDto }) reviewer!: UserRefDto;
  @ApiProperty({ enum: REVIEWER_KINDS }) reviewerKind!: ReviewerKind;
  @ApiProperty(timestamp) at!: string;
}
export class ProposalListItemDto {
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) targetPath!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty(nullableString) section!: string | null;
  @ApiProperty(nullableString) sectionTitle!: string | null;
  @ApiProperty({ type: UserRefDto }) submitter!: UserRefDto;
  @ApiProperty({ enum: STATES }) state!: (typeof STATES)[number];
  @ApiProperty({ enum: LIST_TABS }) tab!: (typeof LIST_TABS)[number];
  @ApiProperty({ enum: PHASES, enumName: 'PublicationPhase', nullable: true }) phase!: Phase | null;
  @ApiProperty({ type: Boolean }) withdrawn!: boolean;
  @ApiProperty({ type: Boolean }) conflict!: boolean;
  @ApiProperty({ type: [UserRefDto] }) assignees!: UserRefDto[];
  @ApiProperty({ type: ListDecisionDto, nullable: true }) decision!: ListDecisionDto | null;
  @ApiProperty(nullableString) publishedVersion!: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) autoPublished!: boolean | null;
  @ApiProperty(timestamp) createdAt!: string;
  @ApiProperty(timestamp) updatedAt!: string;
}
class TabCountsDto {
  @ApiProperty({ type: 'integer' }) open!: number;
  @ApiProperty({ type: 'integer' }) stale!: number;
  @ApiProperty({ type: 'integer' }) blocked!: number;
  @ApiProperty({ type: 'integer' }) published!: number;
  @ApiProperty({ type: 'integer' }) rejected!: number;
  @ApiProperty({ type: 'integer' }) all!: number;
}
export class ProposalListDto {
  @ApiProperty({ type: [ProposalListItemDto] }) items!: ProposalListItemDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
  @ApiProperty({ type: TabCountsDto }) counts!: TabCountsDto;
}
export class BindingDto {
  @ApiProperty({ type: String }) bundleHash!: string;
  @ApiProperty({ type: String }) artifactHash!: string;
  @ApiProperty(timestamp) previewAt!: string;
  @ApiProperty({ type: 'integer' }) discussionVersion!: number;
  @ApiProperty({ type: 'integer' }) disputeVersion!: number;
}
export class PreviewDto {
  @ApiProperty({ type: String, description: 'The exact file that approval publishes' })
  artifact!: string;
  @ApiProperty({ type: String }) artifactHash!: string;
  @ApiProperty(timestamp) previewAt!: string;
  @ApiProperty({ type: String, format: 'uuid' }) decisionId!: string;
  @ApiProperty({ enum: REVIEWER_KINDS }) reviewerKind!: ReviewerKind;
  @ApiProperty({ type: BindingDto }) binding!: BindingDto;
}
class FinalDto {
  @ApiProperty({ type: String }) artifact!: string;
  @ApiProperty({ type: String }) artifactHash!: string;
}
class WithdrawnDto {
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty(timestamp) at!: string;
}
class BlockedByDto {
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ enum: PHASES, enumName: 'PublicationPhase' }) phase!: Phase;
}
export class RefStatusDto {
  @ApiProperty({ enum: ['target', 'source', 'scope'] }) role!: 'target' | 'source' | 'scope';
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty(nullableString) versionLabel!: string | null;
  @ApiProperty(nullableString) sha256!: string | null;
  @ApiProperty(nullableString) currentVersionLabel!: string | null;
  @ApiProperty({ type: Boolean, description: 'Unchanged since the author read it' })
  current!: boolean;
}
class ConflictVersionDto {
  @ApiProperty({ type: String }) versionLabel!: string;
  @ApiProperty({ type: String }) sha256!: string;
}
class PublishedByDto {
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ enum: REVIEWER_KINDS }) reviewerKind!: ReviewerKind;
}
class ConflictCurrentDto extends ConflictVersionDto {
  @ApiProperty({ type: PublishedByDto, nullable: true }) publishedBy!: PublishedByDto | null;
}
export class ConflictResolutionDto {
  @ApiProperty({ enum: CONFLICT_OUTCOMES }) outcome!: (typeof CONFLICT_OUTCOMES)[number];
  @ApiProperty({ type: UserRefDto }) actor!: UserRefDto;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty(nullableString) baseSha256!: string | null;
  @ApiProperty(nullableString) currentSha256!: string | null;
  @ApiProperty(nullableString) replacementSlug!: string | null;
  @ApiProperty(timestamp) createdAt!: string;
}
export class ConflictDto {
  @ApiProperty(nullableString) section!: string | null;
  @ApiProperty({ enum: ['section', 'page'] }) scope!: 'section' | 'page';
  @ApiProperty({ type: ConflictVersionDto, nullable: true }) base!: ConflictVersionDto | null;
  @ApiProperty({ type: ConflictCurrentDto, nullable: true }) current!: ConflictCurrentDto | null;
  @ApiProperty({ type: String }) baseText!: string;
  @ApiProperty({ type: String }) currentText!: string;
  @ApiProperty({ type: String }) proposedText!: string;
  @ApiProperty({ type: ConflictResolutionDto, nullable: true })
  resolution!: ConflictResolutionDto | null;
}
class DiscussionDto {
  @ApiProperty({ type: 'integer' }) discussionVersion!: number;
  @ApiProperty({ type: 'integer' }) disputeVersion!: number;
  @ApiProperty({ type: Boolean, description: 'held or disputeOpen: approval is blocked' })
  disputed!: boolean;
  @ApiProperty({ type: Boolean, description: 'the proposal topic exists and is not resolved' })
  held!: boolean;
  @ApiProperty({ type: Boolean, description: 'the dispute log is open' }) disputeOpen!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) topicId!: string | null;
}
class CanDto {
  @ApiProperty({ type: Boolean }) decide!: boolean;
  @ApiProperty({ type: Boolean }) publish!: boolean;
  @ApiProperty({ type: Boolean }) withdraw!: boolean;
  @ApiProperty({ type: Boolean }) resolveConflict!: boolean;
  @ApiProperty({ type: Boolean }) resolveBlocked!: boolean;
}
export class ProposalEventDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty(timestamp) at!: string;
  @ApiProperty({ type: String }) action!: string;
  @ApiProperty({ type: UserRefDto, nullable: true, description: 'null = system' })
  actor!: UserRefDto | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) data!: Record<string, unknown>;
}
export class ProposalDetailDto extends ProposalDto {
  @ApiProperty({ enum: LIST_TABS }) tab!: (typeof LIST_TABS)[number];
  @ApiProperty({ type: WithdrawnDto, nullable: true }) withdrawn!: WithdrawnDto | null;
  @ApiProperty({ type: PreviewDto, nullable: true }) preview!: PreviewDto | null;
  @ApiProperty({ type: FinalDto, nullable: true }) final!: FinalDto | null;
  @ApiProperty({ type: AssignmentDto, nullable: true }) assignment!: AssignmentDto | null;
  @ApiProperty({ type: [DecisionDto] }) decisions!: DecisionDto[];
  @ApiProperty({ type: PublicationDto, nullable: true }) publication!: PublicationDto | null;
  @ApiProperty({ type: [PublicationDto] }) publications!: PublicationDto[];
  @ApiProperty({ type: BlockedByDto, nullable: true }) blockedBy!: BlockedByDto | null;
  @ApiProperty({ type: [RefStatusDto] }) refs!: RefStatusDto[];
  @ApiProperty({ type: ConflictDto, nullable: true }) conflict!: ConflictDto | null;
  @ApiProperty({ type: DiscussionDto }) discussion!: DiscussionDto;
  @ApiProperty({ type: CanDto }) can!: CanDto;
  @ApiProperty({ type: [ProposalEventDto] }) history!: ProposalEventDto[];
}
class DiffLineDto {
  @ApiProperty({ enum: ['same', 'del', 'add'] }) kind!: 'same' | 'del' | 'add';
  @ApiProperty({ type: String }) text!: string;
  @ApiProperty({ type: 'integer', nullable: true }) oldLine!: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) newLine!: number | null;
}
class DiffFromDto {
  @ApiProperty(nullableString) versionLabel!: string | null;
  @ApiProperty(nullableString) sha256!: string | null;
  @ApiProperty({ type: String }) text!: string;
}
class DiffToDto {
  @ApiProperty({ type: String }) sha256!: string;
  @ApiProperty({ type: String }) text!: string;
}
class DiffStatsDto {
  @ApiProperty({ type: 'integer' }) added!: number;
  @ApiProperty({ type: 'integer' }) removed!: number;
}
export class ProposalDiffDto {
  @ApiProperty({ enum: ['base', 'current'] }) against!: 'base' | 'current';
  @ApiProperty({ type: DiffFromDto }) from!: DiffFromDto;
  @ApiProperty({ type: DiffToDto }) to!: DiffToDto;
  @ApiProperty({ type: [DiffLineDto] }) lines!: DiffLineDto[];
  @ApiProperty({ type: DiffStatsDto }) stats!: DiffStatsDto;
}
export class ConflictResultDto {
  @ApiProperty({ type: ConflictResolutionDto }) resolution!: ConflictResolutionDto;
  @ApiProperty({ type: ProposalDto, nullable: true }) replacement!: ProposalDto | null;
}
class ShaDto {
  @ApiProperty({ type: String }) sha256!: string;
}
class OldShaDto {
  @ApiProperty(nullableString) sha256!: string | null;
}
class DiskDto {
  @ApiProperty(nullableString) sha256!: string | null;
  @ApiProperty({ enum: ['new', 'old', 'neither', 'missing'] })
  matches!: 'new' | 'old' | 'neither' | 'missing';
}
export class BlockedTargetDto {
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) targetPath!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty(timestamp) since!: string;
  @ApiProperty(nullableString) error!: string | null;
  @ApiProperty({ type: String, format: 'uuid' }) publicationId!: string;
  @ApiProperty({ type: ShaDto }) expected!: ShaDto;
  @ApiProperty({ type: OldShaDto }) old!: OldShaDto;
  @ApiProperty({
    type: DiskDto,
    nullable: true,
    description: 'null when the file could not be read',
  })
  disk!: DiskDto | null;
  @ApiProperty({ type: [String] }) waiting!: string[];
}
export class BlockedListDto {
  @ApiProperty({ type: [BlockedTargetDto] }) items!: BlockedTargetDto[];
}
export class AuditEventDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty(timestamp) at!: string;
  @ApiProperty({ type: String }) action!: string;
  @ApiProperty({ enum: ['human', 'agent', 'system'] }) actorKind!: 'human' | 'agent' | 'system';
  @ApiProperty({ type: UserRefDto, nullable: true }) actor!: UserRefDto | null;
  @ApiProperty({ type: String }) subjectType!: string;
  @ApiProperty({ type: String }) subjectId!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) data!: Record<string, unknown>;
}
export class AuditPageDto {
  @ApiProperty({ type: [AuditEventDto] }) items!: AuditEventDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
}
export class EventDto {
  @ApiProperty({ enum: EVENT_TYPES, enumName: 'EventType' }) type!: EventType;
  @ApiPropertyOptional({ type: String }) slug?: string;
  @ApiPropertyOptional({ type: String }) path?: string;
  @ApiPropertyOptional({ type: String }) state?: string;
  @ApiPropertyOptional({ enum: PHASES, enumName: 'PublicationPhase' }) phase?: Phase;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) topicId?: string;
  @ApiPropertyOptional({ type: 'integer' }) version?: number;
  @ApiProperty(timestamp) at!: string;
}
