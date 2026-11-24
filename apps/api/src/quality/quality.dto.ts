import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SEVERITIES, type Severity } from '@md-wiki/domain';
import { UserRefDto } from '../review/review.dto.js';
import { QualitySummaryDto, RUN_STATUSES, SeverityCountsDto } from './quality-summary.dto.js';

export { QualitySummaryDto, RUN_STATUSES, SeverityCountsDto };

/** Quality check wire DTOs (system-logic §7.6.7). */

const timestamp = { type: String, format: 'date-time' } as const;
const nullableTimestamp = { type: String, format: 'date-time', nullable: true } as const;
const nullableString = { type: String, nullable: true } as const;
const nullableInt = { type: 'integer', nullable: true } as const;
export const TRIGGERS = ['submit', 'rerun', 'self_check'] as const;
// Phase 8 adds the agent_review kind and its triggers (system-logic §7.8.6).
export const AGENT_TRIGGERS = ['after_check', 'returned', 'resumed'] as const;
// Phase 9b credibility jobs (system-logic §7.7.12, D-230).
export const CREDIBILITY_TRIGGERS = ['manual', 'weekly', 'daily', 'internal'] as const;
export const JOB_TRIGGERS = ['dev', ...TRIGGERS, ...AGENT_TRIGGERS, ...CREDIBILITY_TRIGGERS] as const;
export const JOB_KINDS = [
  'ping',
  'quality_check',
  'agent_review',
  'retraction_check',
  'copy_candidates',
  'relation_candidates',
  'credibility_score',
] as const;
type RunStatus = (typeof RUN_STATUSES)[number];

const integer = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : (value as unknown);

export class JobListInput {
  @IsOptional() @IsIn(JOB_KINDS) kind?: (typeof JOB_KINDS)[number];
  @IsOptional() @IsIn(RUN_STATUSES) status?: RunStatus;
  @IsOptional() @Transform(integer) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() cursor?: string;
}

export class QuoteRefDto {
  @ApiProperty({ type: String }) block!: string;
  @ApiProperty({ type: String }) text!: string;
}
export class FindingDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) rule!: string;
  @ApiProperty(nullableString) ruleTitle!: string | null;
  @ApiProperty({ enum: SEVERITIES, enumName: 'FindingSeverity' }) severity!: Severity;
  @ApiProperty({ type: String }) message!: string;
  @ApiProperty({ type: String, description: 'Data block id the quote is from' }) block!: string;
  @ApiProperty({ type: String }) quote!: string;
  @ApiProperty(nullableInt) lineStart!: number | null;
  @ApiProperty(nullableInt) lineEnd!: number | null;
  @ApiProperty({ enum: ['model', 'rule'], enumName: 'FindingOrigin' }) origin!: 'model' | 'rule';
  @ApiProperty({ type: QuoteRefDto, nullable: true }) original!: QuoteRefDto | null;
}
export class DroppedDto {
  @ApiProperty({ type: 'integer' }) unknownRule!: number;
  @ApiProperty({ type: 'integer' }) unknownBlock!: number;
  @ApiProperty({ type: 'integer' }) emptyQuote!: number;
  @ApiProperty({ type: 'integer' }) quoteNotFound!: number;
  @ApiProperty({ type: 'integer' }) total!: number;
}
export class JobErrorDto {
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) message!: string;
}
export class QualityRunDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: TRIGGERS, enumName: 'QualityTrigger' }) trigger!: (typeof TRIGGERS)[number];
  @ApiProperty({ enum: RUN_STATUSES, enumName: 'JobStatus' }) status!: RunStatus;
  @ApiProperty({ type: String }) bundleHash!: string;
  @ApiProperty({ type: Boolean, description: "bundleHash equals the subject's current hash" })
  current!: boolean;
  @ApiProperty(nullableString) rulesSha256!: string | null;
  @ApiProperty({ type: Boolean }) rulesChanged!: boolean;
  @ApiProperty(nullableString) provider!: string | null;
  @ApiProperty(nullableString) model!: string | null;
  @ApiProperty(nullableString) promptVersion!: string | null;
  @ApiProperty(nullableInt) tokensIn!: number | null;
  @ApiProperty(nullableInt) tokensOut!: number | null;
  @ApiProperty({ type: JobErrorDto, nullable: true }) error!: JobErrorDto | null;
  @ApiProperty({ type: DroppedDto, nullable: true }) dropped!: DroppedDto | null;
  @ApiProperty({ type: SeverityCountsDto }) counts!: SeverityCountsDto;
  @ApiProperty({ type: [FindingDto] }) findings!: FindingDto[];
  @ApiProperty({ type: UserRefDto, nullable: true }) requestedBy!: UserRefDto | null;
  @ApiProperty(timestamp) createdAt!: string;
  @ApiProperty(nullableTimestamp) startedAt!: string | null;
  @ApiProperty(nullableTimestamp) finishedAt!: string | null;
}
class QualitySubjectDto {
  @ApiProperty({ enum: ['proposal', 'draft'] }) kind!: 'proposal' | 'draft';
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty(nullableString) slug!: string | null;
}
class ReportCanDto {
  @ApiProperty({ type: Boolean }) rerun!: boolean;
}
export class QualityReportDto {
  @ApiProperty({ type: QualitySubjectDto }) subject!: QualitySubjectDto;
  @ApiProperty({ type: String, description: "The subject's current hash" }) bundleHash!: string;
  @ApiProperty({ type: QualitySummaryDto }) summary!: QualitySummaryDto;
  @ApiProperty({ type: QualityRunDto, nullable: true }) current!: QualityRunDto | null;
  @ApiProperty({ type: QualityRunDto, nullable: true }) latest!: QualityRunDto | null;
  @ApiProperty({
    type: [QualityRunDto],
    description: 'Newest first, at most 10; findings only on current and latest',
  })
  runs!: QualityRunDto[];
  @ApiProperty({ type: ReportCanDto }) can!: ReportCanDto;
}

class ModelJobDto {
  @ApiProperty({ enum: ['quality_check'] }) kind!: 'quality_check';
  @ApiProperty({ type: String }) provider!: string;
  @ApiProperty({ type: String }) model!: string;
  @ApiProperty({ type: 'integer' }) maxTokens!: number;
  @ApiProperty({ type: Number }) timeoutS!: number;
  @ApiProperty({ type: 'integer' }) maxAttempts!: number;
  @ApiProperty({ type: Boolean, description: 'A per-kind override is set' }) overridden!: boolean;
}
class OpenAiCompatDto {
  @ApiProperty({ ...nullableString, description: 'scheme://host:port only' })
  baseUrl!: string | null;
}
class LastUsedDto {
  @ApiProperty({ type: String }) kind!: string;
  @ApiProperty({ type: String }) provider!: string;
  @ApiProperty({ type: String }) model!: string;
  @ApiProperty(nullableString) promptVersion!: string | null;
  @ApiProperty(timestamp) at!: string;
}
export class ModelsDto {
  @ApiProperty({ type: [ModelJobDto] }) jobs!: ModelJobDto[];
  @ApiProperty({ type: OpenAiCompatDto }) openaiCompat!: OpenAiCompatDto;
  @ApiProperty({ type: [LastUsedDto] }) lastUsed!: LastUsedDto[];
}
class RuleDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) body!: string;
}
export class RulesDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty(nullableString) sha256!: string | null;
  @ApiProperty(nullableInt) size!: number | null;
  @ApiProperty(nullableString) error!: string | null;
  @ApiProperty({ type: [RuleDto] }) rules!: RuleDto[];
  @ApiProperty({ type: String }) preamble!: string;
}

class JobSubjectDto {
  @ApiProperty({ enum: ['proposal', 'draft'] }) kind!: 'proposal' | 'draft';
  @ApiProperty({ ...nullableString, description: 'null for drafts' }) slug!: string | null;
  @ApiProperty({ ...nullableString, description: 'null for drafts' }) title!: string | null;
}
export class JobListItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: JOB_KINDS, enumName: 'JobKind' }) kind!: (typeof JOB_KINDS)[number];
  @ApiProperty({ enum: JOB_TRIGGERS, enumName: 'JobTrigger' })
  trigger!: (typeof JOB_TRIGGERS)[number];
  @ApiProperty({ enum: RUN_STATUSES, enumName: 'JobStatus' }) status!: RunStatus;
  @ApiProperty({ type: JobSubjectDto, nullable: true }) subject!: JobSubjectDto | null;
  @ApiProperty(nullableString) provider!: string | null;
  @ApiProperty(nullableString) model!: string | null;
  @ApiProperty(nullableString) promptVersion!: string | null;
  @ApiProperty(nullableInt) tokensIn!: number | null;
  @ApiProperty(nullableInt) tokensOut!: number | null;
  @ApiProperty(nullableInt) findings!: number | null;
  @ApiProperty({ type: JobErrorDto, nullable: true }) error!: JobErrorDto | null;
  @ApiProperty(timestamp) createdAt!: string;
  @ApiProperty(nullableTimestamp) startedAt!: string | null;
  @ApiProperty(nullableTimestamp) finishedAt!: string | null;
  @ApiProperty(nullableInt) durationMs!: number | null;
}
export class JobKindSummaryDto {
  @ApiProperty({ enum: JOB_KINDS, enumName: 'JobKind' }) kind!: (typeof JOB_KINDS)[number];
  @ApiProperty({ type: 'integer' }) queued!: number;
  @ApiProperty({ type: 'integer' }) running!: number;
  @ApiProperty({ type: 'integer' }) failed24h!: number;
  @ApiProperty({ type: JobListItemDto, nullable: true, description: 'Latest finished run' })
  last!: JobListItemDto | null;
}
export class JobListDto {
  @ApiProperty({ type: [JobKindSummaryDto] }) kinds!: JobKindSummaryDto[];
  @ApiProperty({ type: [JobListItemDto] }) items!: JobListItemDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
}
