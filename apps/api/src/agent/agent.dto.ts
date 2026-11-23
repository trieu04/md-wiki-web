import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { INBOX_TABS, type InboxTab } from '@md-wiki/domain';
import { UserRefDto } from '../review/review.dto.js';

/** DTOs of system-logic §7.8 (self-managed review). */

const timestamp = { type: String, format: 'date-time' } as const;
const nullableTimestamp = { type: String, format: 'date-time', nullable: true } as const;
const nullableString = { type: String, nullable: true } as const;
const HASH = /^[a-f0-9]{64}$/;
const NON_BLANK = /\S/;
const TRIGGER_ID = /^(?:[a-z_]{1,40}|custom:[a-z][a-z0-9-]{0,39})$/;
const REASON_LIMIT = 4000;
const trimmed = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);
const integer = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : (value as unknown);

export const ESCALATION_KINDS = ['rereview', 'discussion'] as const;
export type EscalationKind = (typeof ESCALATION_KINDS)[number];
export const AGENT_OUTCOMES = ['approved', 'rejected', 'escalated', 'left_pending'] as const;
const RESOLUTIONS = ['decided', 'withdrawn', 'discussion_closed'] as const;
const AUTHOR_SOURCES = ['owners_file', 'published_authors', 'owner'] as const;
const SPOT_OUTCOMES = ['passed', 'failed'] as const;
const INBOX_KINDS = ['review', 'rereview', 'discussion', 'spot_check', 'mention', 'check'] as const;
const INBOX_ACTIONS = ['decide', 'discuss', 'spot_check', 'reply', 'open'] as const;

// ---- inputs -------------------------------------------------------------------------------

export class EscalationInput {
  @ApiProperty({ enum: ESCALATION_KINDS, enumName: 'EscalationKind' })
  @IsIn(ESCALATION_KINDS)
  kind!: EscalationKind;
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: REASON_LIMIT,
    description: 'Why: the notes page authors read (claims checked, what is uncertain)',
  })
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(REASON_LIMIT)
  reason!: string;
  @ApiPropertyOptional({
    type: [String],
    maxItems: 20,
    description: 'Trigger ids the caller cites (`judgement` for its own); firing ones are added',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(TRIGGER_ID, { each: true })
  triggers?: string[];
  @ApiProperty({ type: String, pattern: HASH.source }) @IsString() @Matches(HASH) bundleHash!: string;
}

export class InboxInput {
  @IsOptional() @IsIn(INBOX_TABS) tab?: InboxTab;
  @IsOptional() @Transform(integer) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(80) cursor?: string;
}

export class SpotCheckIdInput {
  @IsUUID() id!: string;
}
export class SpotCheckInput {
  @ApiProperty({ enum: SPOT_OUTCOMES, enumName: 'SpotCheckOutcome' })
  @IsIn(SPOT_OUTCOMES)
  outcome!: (typeof SPOT_OUTCOMES)[number];
  @ApiProperty({ type: String, minLength: 1, maxLength: REASON_LIMIT })
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(REASON_LIMIT)
  reason!: string;
  @ApiPropertyOptional({
    type: [String],
    maxItems: 50,
    description: 'Sections at fault (failed only); default the proposal section or every section',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  anchors?: string[];
}

export class CustomTriggerInput {
  @ApiProperty({ type: String, pattern: '^[a-z][a-z0-9-]{0,39}$' })
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{0,39}$/)
  id!: string;
  @ApiProperty({ enum: ['path', 'term'], enumName: 'CustomTriggerKind' })
  @IsIn(['path', 'term'])
  kind!: 'path' | 'term';
  @ApiProperty({ type: String, minLength: 1, maxLength: 200 })
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(200)
  value!: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @Transform(trimmed)
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(500)
  reason!: string;
}
export class ReviewSettingsInput {
  @ApiPropertyOptional({ enum: ['self_managed', 'human'], enumName: 'ReviewModel' })
  @IsOptional()
  @IsIn(['self_managed', 'human'])
  reviewModel?: 'self_managed' | 'human';
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 1, description: 'Steps of 0.01' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1)
  spotCheckRate?: number;
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  reminderDays?: number;
  @ApiPropertyOptional({
    type: Boolean,
    description: 'The one default trigger the owner may turn off (agent edits of human pages)',
  })
  @IsOptional()
  @IsBoolean()
  agentEditsHumanPages?: boolean;
  @ApiPropertyOptional({
    type: [CustomTriggerInput],
    maxItems: 20,
    description: 'Replaces the owner-added triggers (defaults cannot be removed)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CustomTriggerInput)
  customTriggers?: CustomTriggerInput[];
}
export class AgentPauseInput {
  @ApiProperty({ type: Boolean, description: 'true pauses, false resumes the reviewer agent' })
  @IsBoolean()
  paused!: boolean;
  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  reason?: string;
}
export class AgentMetricsInput {
  @IsOptional() @Transform(integer) @IsInt() @Min(1) @Max(90) days?: number;
}

// ---- escalations --------------------------------------------------------------------------

export class FiredTriggerDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) detail!: string;
}
export class EscalationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ESCALATION_KINDS, enumName: 'EscalationKind' }) kind!: EscalationKind;
  @ApiProperty({ type: [String] }) triggers!: string[];
  @ApiProperty({ type: String, description: 'The requester’s notes (the agent’s notes, AI)' })
  notes!: string;
  @ApiProperty({ type: UserRefDto }) requestedBy!: UserRefDto;
  @ApiProperty({ type: [UserRefDto] }) assignees!: UserRefDto[];
  @ApiProperty({ ...nullableString, format: 'uuid' }) topicId!: string | null;
  @ApiProperty(timestamp) createdAt!: string;
  @ApiProperty(nullableTimestamp) resolvedAt!: string | null;
  @ApiProperty({ enum: RESOLUTIONS, enumName: 'EscalationResolution', nullable: true })
  resolution!: (typeof RESOLUTIONS)[number] | null;
  @ApiProperty({ type: 'integer' }) reminders!: number;
  @ApiProperty(nullableTimestamp) lastRemindedAt!: string | null;
}
export class AgentClaimDto {
  @ApiProperty({ type: String }) claim!: string;
  @ApiProperty(nullableString) source!: string | null;
  @ApiProperty({ type: Boolean }) supported!: boolean;
}
export class AgentRefusalDto {
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: [String] }) triggers!: string[];
}
export class AgentReviewDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) jobId!: string;
  @ApiProperty({ enum: AGENT_OUTCOMES, enumName: 'AgentOutcome' })
  outcome!: (typeof AGENT_OUTCOMES)[number];
  @ApiProperty({ enum: ['approve', 'reject', 'escalate'], enumName: 'AgentVerdict', nullable: true })
  verdict!: 'approve' | 'reject' | 'escalate' | null;
  @ApiProperty({ type: String }) notes!: string;
  @ApiProperty({ type: [AgentClaimDto] }) claims!: AgentClaimDto[];
  @ApiProperty({ type: [AgentRefusalDto] }) refusals!: AgentRefusalDto[];
  @ApiProperty({ ...nullableString, format: 'uuid' }) decisionId!: string | null;
  @ApiProperty({ ...nullableString, format: 'uuid' }) escalationId!: string | null;
  @ApiProperty(nullableString) provider!: string | null;
  @ApiProperty(nullableString) model!: string | null;
  @ApiProperty({ type: String }) promptVersion!: string;
  @ApiProperty(timestamp) createdAt!: string;
}
export class AgentRunDto {
  @ApiProperty({ type: String, format: 'uuid' }) jobId!: string;
  @ApiProperty({ enum: ['queued', 'running', 'succeeded', 'failed'], enumName: 'JobStatus' })
  status!: 'queued' | 'running' | 'succeeded' | 'failed';
  @ApiProperty({ enum: ['after_check', 'returned', 'resumed'], enumName: 'AgentRunTrigger' })
  trigger!: 'after_check' | 'returned' | 'resumed';
  @ApiProperty(nullableString) errorCode!: string | null;
  @ApiProperty(timestamp) createdAt!: string;
}
export class PageAuthorsDto {
  @ApiProperty({ type: [UserRefDto] }) users!: UserRefDto[];
  @ApiProperty({ enum: AUTHOR_SOURCES, enumName: 'PageAuthorSource' })
  source!: (typeof AUTHOR_SOURCES)[number];
}
export class SpotCheckDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) targetPath!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty({ type: String }) versionLabel!: string;
  @ApiProperty({ type: String, format: 'uuid' }) decisionId!: string;
  @ApiProperty({ type: UserRefDto }) reviewer!: UserRefDto;
  @ApiProperty({ type: [UserRefDto] }) assignees!: UserRefDto[];
  @ApiProperty(timestamp) sampledAt!: string;
  @ApiProperty({ enum: SPOT_OUTCOMES, enumName: 'SpotCheckOutcome', nullable: true })
  outcome!: (typeof SPOT_OUTCOMES)[number] | null;
  @ApiProperty(nullableString) reason!: string | null;
  @ApiProperty({ type: [String] }) anchors!: string[];
  @ApiProperty({ type: UserRefDto, nullable: true }) decidedBy!: UserRefDto | null;
  @ApiProperty(nullableTimestamp) decidedAt!: string | null;
  @ApiProperty({ type: Boolean }) canDecide!: boolean;
}
class EscalationCanDto {
  @ApiProperty({ type: Boolean }) escalate!: boolean;
}
export class EscalationStateDto {
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) bundleHash!: string;
  @ApiProperty({ type: String }) state!: string;
  @ApiProperty({
    type: [FiredTriggerDto],
    description: 'Mandatory triggers firing now (an agent approval would be refused)',
  })
  firing!: FiredTriggerDto[];
  @ApiProperty(timestamp) evaluatedAt!: string;
  @ApiProperty({ type: PageAuthorsDto }) pageAuthors!: PageAuthorsDto;
  @ApiProperty({ type: [EscalationDto], description: 'Newest first' }) escalations!: EscalationDto[];
  @ApiProperty({ type: [AgentReviewDto], description: 'Newest first, at most 10' })
  agentReviews!: AgentReviewDto[];
  @ApiProperty({ type: [AgentRunDto], description: 'agent_review jobs, newest first, ≤ 10' })
  agentRuns!: AgentRunDto[];
  @ApiProperty({ type: SpotCheckDto, nullable: true }) spotCheck!: SpotCheckDto | null;
  @ApiProperty({ type: EscalationCanDto }) can!: EscalationCanDto;
}

// ---- inbox --------------------------------------------------------------------------------

class InboxProposalDto {
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) state!: string;
}
export class InboxItemDto {
  @ApiProperty({ type: String, description: '`<kind>:<row id>`' }) id!: string;
  @ApiProperty({ enum: INBOX_KINDS, enumName: 'InboxKind' }) kind!: (typeof INBOX_KINDS)[number];
  @ApiProperty({ enum: ['decide', 'check', 'spot', 'mentions'], enumName: 'InboxItemTab' })
  tab!: 'decide' | 'check' | 'spot' | 'mentions';
  @ApiProperty({ type: Boolean }) done!: boolean;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty(nullableString) anchor!: string | null;
  @ApiProperty({ type: InboxProposalDto, nullable: true }) proposal!: InboxProposalDto | null;
  @ApiProperty({ ...nullableString, format: 'uuid' }) topicId!: string | null;
  @ApiProperty({ ...nullableString, format: 'uuid' }) spotCheckId!: string | null;
  @ApiProperty({ type: String, description: 'Why the item is here' }) why!: string;
  @ApiProperty({ type: [String] }) triggers!: string[];
  @ApiProperty({ ...nullableString, description: 'The agent’s notes (AI)' })
  agentNotes!: string | null;
  @ApiProperty({ type: UserRefDto, nullable: true }) from!: UserRefDto | null;
  @ApiProperty(timestamp) at!: string;
  @ApiProperty({ type: 'integer' }) reminders!: number;
  @ApiProperty({ enum: INBOX_ACTIONS, enumName: 'InboxAction' })
  action!: (typeof INBOX_ACTIONS)[number];
}
class InboxCountsDto {
  @ApiProperty({ type: 'integer' }) all!: number;
  @ApiProperty({ type: 'integer' }) decide!: number;
  @ApiProperty({ type: 'integer' }) check!: number;
  @ApiProperty({ type: 'integer' }) spot!: number;
  @ApiProperty({ type: 'integer' }) mentions!: number;
  @ApiProperty({ type: 'integer' }) done!: number;
}
export class InboxDto {
  @ApiProperty({ type: [InboxItemDto] }) items!: InboxItemDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
  @ApiProperty({ type: InboxCountsDto }) counts!: InboxCountsDto;
}

// ---- settings and operations ---------------------------------------------------------------

class AgentStatusDto {
  @ApiProperty({ type: UserRefDto, nullable: true }) user!: UserRefDto | null;
  @ApiProperty({ type: Boolean, description: 'Enabled with a live review token' })
  available!: boolean;
  @ApiProperty({ type: Boolean, description: 'REVIEWER_AGENT_TOKEN is set' })
  tokenConfigured!: boolean;
  @ApiProperty({ type: Boolean }) paused!: boolean;
  @ApiProperty(nullableTimestamp) pausedAt!: string | null;
  @ApiProperty({ type: UserRefDto, nullable: true }) pausedBy!: UserRefDto | null;
  @ApiProperty(nullableString) pauseReason!: string | null;
}
class TriggerMatchDto {
  @ApiProperty({ enum: ['path', 'term'], enumName: 'CustomTriggerKind' }) kind!: 'path' | 'term';
  @ApiProperty({ type: String }) value!: string;
}
export class TriggerSettingDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ enum: ['default', 'custom'], enumName: 'TriggerSource' })
  source!: 'default' | 'custom';
  @ApiProperty({ type: Boolean }) enabled!: boolean;
  @ApiProperty({ type: Boolean, description: 'The owner may turn it off' }) optional!: boolean;
  @ApiProperty({ type: TriggerMatchDto, nullable: true }) match!: TriggerMatchDto | null;
}
class OwnersFileDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty(nullableString) versionLabel!: string | null;
  @ApiProperty({ type: 'integer' }) rules!: number;
  @ApiProperty({ type: [String] }) warnings!: string[];
}
class PageAuthorSettingsDto {
  @ApiProperty({ enum: AUTHOR_SOURCES, isArray: true, enumName: 'PageAuthorSource' })
  order!: (typeof AUTHOR_SOURCES)[number][];
  @ApiProperty({ type: OwnersFileDto }) ownersFile!: OwnersFileDto;
}
class QualitySettingDto {
  @ApiProperty({ type: Boolean }) onSubmit!: boolean;
  @ApiProperty({ type: String }) rulesPath!: string;
}
export class ReviewSettingsDto {
  @ApiProperty({ enum: ['self_managed', 'human'], enumName: 'ReviewModel' })
  reviewModel!: 'self_managed' | 'human';
  @ApiProperty({ type: Boolean, description: 'AUTO_PUBLISH from the environment (read-only)' })
  autoPublish!: boolean;
  @ApiProperty({ type: AgentStatusDto }) agent!: AgentStatusDto;
  @ApiProperty({ type: [TriggerSettingDto] }) triggers!: TriggerSettingDto[];
  @ApiProperty({ type: PageAuthorSettingsDto }) pageAuthors!: PageAuthorSettingsDto;
  @ApiProperty({ type: Number }) spotCheckRate!: number;
  @ApiProperty({ type: 'integer' }) reminderDays!: number;
  @ApiProperty({ type: QualitySettingDto }) qualityCheck!: QualitySettingDto;
  @ApiProperty(nullableTimestamp) updatedAt!: string | null;
  @ApiProperty({ type: UserRefDto, nullable: true }) updatedBy!: UserRefDto | null;
}
class EscalatedCountsDto {
  @ApiProperty({ type: 'integer' }) rereview!: number;
  @ApiProperty({ type: 'integer' }) discussion!: number;
  @ApiProperty({ type: 'integer' }) total!: number;
}
class TriggerCountDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: 'integer' }) n!: number;
}
class SpotCheckCountsDto {
  @ApiProperty({ type: 'integer' }) sampled!: number;
  @ApiProperty({ type: 'integer' }) passed!: number;
  @ApiProperty({ type: 'integer' }) failed!: number;
  @ApiProperty({ type: 'integer' }) open!: number;
}
export class AgentMetricsDto {
  @ApiProperty({ type: 'integer' }) days!: number;
  @ApiProperty(timestamp) since!: string;
  @ApiProperty(timestamp) until!: string;
  @ApiProperty({ type: Boolean }) paused!: boolean;
  @ApiProperty({ type: 'integer', description: 'Succeeded agent_review runs' }) reviews!: number;
  @ApiProperty({ type: 'integer', description: 'Decisions by the agent' }) decided!: number;
  @ApiProperty({ type: 'integer' }) approved!: number;
  @ApiProperty({ type: 'integer' }) autoPublished!: number;
  @ApiProperty({ type: 'integer', description: 'Rejections by the agent' }) sentBack!: number;
  @ApiProperty({ type: EscalatedCountsDto }) escalated!: EscalatedCountsDto;
  @ApiProperty({ type: 'integer', description: 'Approvals refused by mandatory triggers' })
  refusedByTriggers!: number;
  @ApiProperty({ type: [TriggerCountDto] }) byTrigger!: TriggerCountDto[];
  @ApiProperty({ type: 'integer' }) leftPending!: number;
  @ApiProperty({ type: 'integer', description: 'Failed agent_review jobs' }) failed!: number;
  @ApiProperty({ type: SpotCheckCountsDto }) spotChecks!: SpotCheckCountsDto;
  @ApiProperty({
    type: 'integer',
    description: 'Agent-approved publications later restored to their base by another publication',
  })
  reverts!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'failed / decided spot checks; null without decided ones',
  })
  approvalErrorRate!: number | null;
}
