import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Allow,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ATTEST_KINDS,
  CHECK_RESULTS,
  EDGE_KINDS,
  FEEDBACK_ANSWERS,
  GATE_CAPABILITIES,
  INVALIDATION_KINDS,
  LABEL_ORDER,
  QUEUE_TYPES,
  REPORT_KINDS,
  SOURCE_CHECK_RESULTS,
  SOURCE_TIERS,
  USE_KINDS,
  WORKED,
  type Label,
} from '@md-wiki/domain';
import { UserRefDto } from '../review/review.dto.js';
import { labelCounts, LabelDto } from '../wiki/read.dto.js';

/** DTOs of system-logic §7.7. */

const timestamp = { type: String, format: 'date-time' } as const;
const nullableString = { type: String, nullable: true } as const;
const hex64 = /^[0-9a-f]{64}$/;
const trimmed = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);
const integer = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : (value as unknown);
const ATTESTATION_STATES = [
  'active',
  'withdrawn',
  'on_old_version',
  'stale',
  'downweighted',
  'open',
  'confirmed',
  'confirmed_error',
  'dismissed',
  'fixed',
] as const;
const EVIDENCE_KINDS = [
  'review',
  'source_check',
  'owner_confirmation',
  'confirmed_error',
  'flag',
  'retraction',
  'report',
  'edge',
  'anchor_link',
] as const;
const SOURCE_STATES = ['retracted', 'changed', 'archived', 'unchecked', 'ok'] as const;
const ACTIVITY_KINDS = ['checks', 'reports', 'all'] as const;

// ---- inputs -------------------------------------------------------------------------------

export class SectionRefInput {
  @ApiProperty({ type: String }) @IsString() @MaxLength(200) path!: string;
  @ApiProperty({ type: String }) @IsString() @Length(1, 200) anchor!: string;
  @ApiProperty({ type: String, pattern: '^[0-9a-f]{64}$' })
  @IsString()
  @Matches(hex64)
  sectionHash!: string;
}
export class SourceCheckInput extends SectionRefInput {
  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 500)
  sourceRef!: string;
  @ApiPropertyOptional({ type: String, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceTitle?: string;
  @ApiProperty({ enum: SOURCE_CHECK_RESULTS }) @IsIn(SOURCE_CHECK_RESULTS) result!: (typeof SOURCE_CHECK_RESULTS)[number];
  @ApiPropertyOptional({ type: String, maxLength: 4000 }) @IsOptional() @IsString() @MaxLength(4000) excerpt?: string;
  @ApiPropertyOptional({ type: String, maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) location?: string;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @IsBoolean() comparedNumbers?: boolean;
  @ApiPropertyOptional({ type: String, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @MaxLength(200) proposalSlug?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) @IsOptional() @IsUUID() sourceSnapshotId?: string;
}
export class OwnerConfirmationInput extends SectionRefInput {
  @ApiProperty({ type: String, minLength: 1, maxLength: 2000 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 2000)
  note!: string;
}
export class AnchorLinkInput {
  @ApiProperty({ type: String }) @IsString() @MaxLength(200) path!: string;
  @ApiProperty({ type: String }) @IsString() @Length(1, 200) oldAnchor!: string;
  @ApiProperty({ type: String }) @IsString() @Length(1, 200) newAnchor!: string;
}
export class SectionParams {
  @Allow() path!: string;
  @IsString() @Length(1, 200) anchor!: string;
}
export class WhyInput {
  @IsOptional() @IsString() @MaxLength(100) versionLabel?: string;
}
export class PeopleInput {
  @IsOptional() @IsIn(['true', 'false']) reveal?: 'true' | 'false';
}
export class SourceWarningsInput {
  @ApiProperty({ type: String }) @IsString() @MaxLength(200) path!: string;
  @ApiProperty({ type: String, maxLength: 1_048_576 }) @IsString() @MaxLength(1_048_576) content!: string;
}

class CheckedSourceInput {
  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 500)
  ref!: string;
  @ApiProperty({ type: Boolean }) @IsBoolean() cited!: boolean;
}
class CheckedDetailsInput {
  @ApiProperty({ type: CheckedSourceInput })
  @IsObject()
  @ValidateNested()
  @Type(() => CheckedSourceInput)
  source!: CheckedSourceInput;
  @ApiProperty({ type: String, minLength: 1, maxLength: 200 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 200)
  location!: string;
  @ApiProperty({ enum: CHECK_RESULTS }) @IsIn(CHECK_RESULTS) result!: (typeof CHECK_RESULTS)[number];
  @ApiProperty({ type: Boolean }) @IsBoolean() comparedNumbers!: boolean;
}
class UsedDetailsInput {
  @ApiProperty({ enum: USE_KINDS }) @IsIn(USE_KINDS) use!: (typeof USE_KINDS)[number];
  @ApiProperty({ enum: WORKED }) @IsIn(WORKED) worked!: (typeof WORKED)[number];
  @ApiPropertyOptional({ type: String, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) change?: string;
}
export class AttestationInput extends SectionRefInput {
  @ApiProperty({ enum: ATTEST_KINDS }) @IsIn(ATTEST_KINDS) kind!: (typeof ATTEST_KINDS)[number];
  @ApiProperty({ type: Boolean }) @IsBoolean() sawCounts!: boolean;
  @ApiPropertyOptional({ type: String, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @ApiPropertyOptional({ type: CheckedDetailsInput })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CheckedDetailsInput)
  checked?: CheckedDetailsInput;
  @ApiPropertyOptional({ type: UsedDetailsInput })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UsedDetailsInput)
  used?: UsedDetailsInput;
}
export class ReportInput extends SectionRefInput {
  @ApiProperty({ enum: REPORT_KINDS }) @IsIn(REPORT_KINDS) kind!: (typeof REPORT_KINDS)[number];
  @ApiPropertyOptional({ type: String, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) quote?: string;
  @ApiPropertyOptional({ type: String, maxLength: 4000 }) @IsOptional() @IsString() @MaxLength(4000) suggestion?: string;
  @ApiPropertyOptional({ type: String, maxLength: 4000 }) @IsOptional() @IsString() @MaxLength(4000) evidence?: string;
  @ApiProperty({ type: Boolean }) @IsBoolean() blocking!: boolean;
  @ApiProperty({ type: Boolean }) @IsBoolean() sawCounts!: boolean;
}
export class WithdrawInput {
  @ApiPropertyOptional({ type: String, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class IdParams {
  @IsUUID() id!: string;
}
export class PageFeedbackInput {
  @ApiProperty({ type: String }) @IsString() @MaxLength(200) path!: string;
  @ApiProperty({ type: String }) @IsString() @Length(1, 100) versionLabel!: string;
  @ApiProperty({ enum: FEEDBACK_ANSWERS }) @IsIn(FEEDBACK_ANSWERS) answer!: (typeof FEEDBACK_ANSWERS)[number];
}
export class ListInput {
  @IsOptional() @Transform(integer) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}
export class QueueInput extends ListInput {
  @IsOptional() @IsIn(QUEUE_TYPES) type?: (typeof QUEUE_TYPES)[number];
}
export class QueueItemParams {
  @IsIn(QUEUE_TYPES) type!: (typeof QUEUE_TYPES)[number];
  @IsString() @Length(1, 200) id!: string;
}
export class DecisionInput {
  @ApiProperty({ enum: QUEUE_TYPES }) @IsIn(QUEUE_TYPES) type!: (typeof QUEUE_TYPES)[number];
  @ApiProperty({ type: String }) @IsString() @Length(1, 200) id!: string;
  @ApiProperty({ type: String }) @IsString() @Length(1, 40) outcome!: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 4000 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 4000)
  reason!: string;
}
export class SourcesInput extends ListInput {
  @IsOptional() @IsIn(SOURCE_STATES) state?: (typeof SOURCE_STATES)[number];
}
class SectionPointInput {
  @ApiProperty({ type: String }) @IsString() @MaxLength(200) path!: string;
  @ApiProperty({ type: String }) @IsString() @Length(1, 200) anchor!: string;
}
export class EdgeCandidateInput {
  @ApiProperty({ enum: EDGE_KINDS }) @IsIn(EDGE_KINDS) kind!: (typeof EDGE_KINDS)[number];
  @ApiProperty({ type: SectionPointInput })
  @IsObject()
  @ValidateNested()
  @Type(() => SectionPointInput)
  src!: SectionPointInput;
  @ApiProperty({ type: SectionPointInput })
  @IsObject()
  @ValidateNested()
  @Type(() => SectionPointInput)
  dst!: SectionPointInput;
  @ApiProperty({ type: Number, minimum: 0, maximum: 1 }) @IsNumber() @Min(0) @Max(1) score!: number;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() detail?: object;
}
export class InvalidationInput {
  @ApiProperty({ enum: INVALIDATION_KINDS }) @IsIn(INVALIDATION_KINDS) kind!: (typeof INVALIDATION_KINDS)[number];
  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 500)
  ref!: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 2000 })
  @Transform(trimmed)
  @IsString()
  @Length(1, 2000)
  detail!: string;
}
export class ActivityInput extends ListInput {
  @IsOptional() @IsIn(ACTIVITY_KINDS) kind?: (typeof ACTIVITY_KINDS)[number];
}
export class GateParams {
  @IsString() @MinLength(1) @MaxLength(60) capability!: string;
}
export class GateInput {
  @ApiProperty({ type: Boolean }) @IsBoolean() enabled!: boolean;
  @ApiPropertyOptional({ type: String, maxLength: 300 }) @IsOptional() @IsString() @MaxLength(1000) runRecord?: string;
  @ApiPropertyOptional({ type: String, format: 'date' }) @IsOptional() @IsString() @MaxLength(20) runDate?: string;
}

// ---- responses ----------------------------------------------------------------------------

export class SourceCheckResultDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: LabelDto }) label!: LabelDto;
  @ApiProperty(timestamp) createdAt!: string;
}
export class AnchorLinkDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) oldAnchor!: string;
  @ApiProperty({ type: String }) newAnchor!: string;
  @ApiProperty({ type: String }) oldHash!: string;
  @ApiProperty({ type: String }) newHash!: string;
  @ApiProperty(timestamp) createdAt!: string;
}
export class EvidenceDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ enum: EVIDENCE_KINDS }) kind!: (typeof EVIDENCE_KINDS)[number];
  @ApiProperty(timestamp) at!: string;
  @ApiProperty({ enum: ['agent', 'person', 'system'] }) actorKind!: 'agent' | 'person' | 'system';
  @ApiProperty({ type: String }) summary!: string;
  @ApiProperty({ enum: SOURCE_CHECK_RESULTS, nullable: true }) result!:
    | (typeof SOURCE_CHECK_RESULTS)[number]
    | null;
  @ApiProperty(nullableString) sourceRef!: string | null;
  @ApiProperty(nullableString) sourceName!: string | null;
  @ApiProperty({ type: Boolean }) valid!: boolean;
  @ApiProperty({ type: Boolean }) onOldVersion!: boolean;
  @ApiProperty({ type: Boolean }) contributes!: boolean;
  @ApiProperty({ type: Boolean, nullable: true }) open!: boolean | null;
}
class WhyCanDto {
  @ApiProperty({ type: Boolean }) recordSourceCheck!: boolean;
  @ApiProperty({ type: Boolean }) confirm!: boolean;
  @ApiProperty({ type: Boolean }) attest!: boolean;
  @ApiProperty({ type: Boolean }) report!: boolean;
}
export class WhyDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) anchor!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) versionLabel!: string;
  @ApiProperty({ type: String }) sectionHash!: string;
  @ApiProperty({ type: LabelDto }) label!: LabelDto;
  @ApiProperty({ type: String }) meaning!: string;
  @ApiProperty({ type: [EvidenceDto] }) evidence!: EvidenceDto[];
  @ApiProperty({ type: [String] }) changeIt!: string[];
  @ApiProperty({ type: String }) note!: string;
  @ApiProperty({ type: Boolean, enum: [false] }) baseRateCalibrated!: false;
  @ApiProperty({ type: WhyCanDto }) can!: WhyCanDto;
}
class TeamCountDto {
  @ApiProperty({ type: String }) team!: string;
  @ApiProperty({ type: 'integer' }) people!: number;
}
class PeopleCountDto {
  @ApiProperty({ type: 'integer' }) people!: number;
  @ApiProperty({ type: [TeamCountDto] }) teams!: TeamCountDto[];
}
class OldVersionCountDto {
  @ApiProperty({ type: 'integer' }) checked!: number;
  @ApiProperty({ type: 'integer' }) used!: number;
}
export class AttestationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty({ type: String }) anchor!: string;
  @ApiProperty(nullableString) sectionTitle!: string | null;
  @ApiProperty({ type: String }) versionLabel!: string;
  @ApiProperty({ enum: [...ATTEST_KINDS, 'report'] }) kind!: (typeof ATTEST_KINDS)[number] | 'report';
  @ApiProperty({ type: 'object', additionalProperties: true }) details!: object;
  @ApiProperty({ type: Boolean }) blocking!: boolean;
  @ApiProperty(nullableString) note!: string | null;
  @ApiProperty({ enum: ATTESTATION_STATES }) state!: (typeof ATTESTATION_STATES)[number];
  @ApiProperty(nullableString) outcomeReason!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) topicId!: string | null;
  @ApiProperty(timestamp) createdAt!: string;
  @ApiProperty(timestamp) undoUntil!: string;
}
export class PeopleDto {
  @ApiProperty({ type: Boolean }) hidden!: boolean;
  @ApiProperty({ type: Boolean }) acted!: boolean;
  @ApiProperty({ type: PeopleCountDto, nullable: true }) checked!: PeopleCountDto | null;
  @ApiProperty({ type: PeopleCountDto, nullable: true }) used!: PeopleCountDto | null;
  @ApiProperty({ type: 'integer', nullable: true }) useful!: number | null;
  @ApiProperty({ type: OldVersionCountDto, nullable: true }) onOldVersion!: OldVersionCountDto | null;
  @ApiProperty({ type: String }) purpose!: string;
  @ApiProperty({ type: [AttestationDto] }) mine!: AttestationDto[];
}
export class AttestationResultDto {
  @ApiProperty({ type: AttestationDto }) attestation!: AttestationDto;
  @ApiProperty({ type: AttestationDto, nullable: true }) report!: AttestationDto | null;
  @ApiProperty({ type: PeopleDto }) people!: PeopleDto;
  @ApiProperty({ type: LabelDto }) label!: LabelDto;
  @ApiProperty({ type: Boolean }) following!: boolean;
}
export class PageFeedbackDto {
  @ApiProperty({ enum: FEEDBACK_ANSWERS }) answer!: (typeof FEEDBACK_ANSWERS)[number];
  @ApiProperty({ type: String }) versionLabel!: string;
  @ApiProperty(timestamp) createdAt!: string;
}
export class SourceTierDto {
  @ApiProperty({ type: String }) source!: string;
  @ApiProperty({ type: String }) match!: string;
  @ApiProperty({ enum: SOURCE_TIERS }) tier!: (typeof SOURCE_TIERS)[number];
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String }) reviewed!: string;
}
export class TierWarningDto {
  @ApiProperty({ type: 'integer' }) line!: number;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) message!: string;
}
export class SourceTiersDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty(nullableString) versionLabel!: string | null;
  @ApiProperty({ type: [SourceTierDto] }) tiers!: SourceTierDto[];
  @ApiProperty({ type: [TierWarningDto] }) warnings!: TierWarningDto[];
}
class AddedSourceDto {
  @ApiProperty({ type: String }) ref!: string;
  @ApiProperty({ enum: SOURCE_TIERS, nullable: true }) tier!: (typeof SOURCE_TIERS)[number] | null;
  @ApiProperty({ type: Boolean }) retracted!: boolean;
  @ApiProperty(nullableString) warning!: string | null;
}
export class SourceWarningsDto {
  @ApiProperty({ type: [AddedSourceDto] }) added!: AddedSourceDto[];
}
export class SectionKeyDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty({ type: String }) anchor!: string;
  @ApiProperty(nullableString) sectionTitle!: string | null;
  @ApiProperty({ type: String }) sectionHash!: string;
  @ApiProperty({ type: LabelDto }) label!: LabelDto;
}
class ReachDto {
  @ApiProperty({ type: 'integer' }) linkedFrom!: number;
  @ApiProperty({ type: 'integer' }) teams!: number;
}
export class QueueItemDto {
  @ApiProperty({ enum: QUEUE_TYPES }) type!: (typeof QUEUE_TYPES)[number];
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) why!: string;
  @ApiProperty({ type: SectionKeyDto, nullable: true }) section!: SectionKeyDto | null;
  @ApiProperty({ type: ReachDto }) reach!: ReachDto;
  @ApiProperty(timestamp) at!: string;
  @ApiProperty({ type: [String] }) outcomes!: string[];
  @ApiProperty({ type: Boolean }) blocking!: boolean;
}
const queueCounts = {
  type: 'object',
  properties: Object.fromEntries([...QUEUE_TYPES, 'all'].map((t) => [t, { type: 'integer' }])),
  required: [...QUEUE_TYPES, 'all'],
  selfRequired: true,
  additionalProperties: false,
} as const;
export class CredibilityQueueDto {
  @ApiProperty({ type: [QueueItemDto] }) items!: QueueItemDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
  @ApiProperty(queueCounts as never) counts!: Record<(typeof QUEUE_TYPES)[number] | 'all', number>;
}
class PropertyDto {
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ type: String }) value!: string;
}
class DecisionRecordDto {
  @ApiProperty({ type: String }) outcome!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: UserRefDto }) actor!: UserRefDto;
  @ApiProperty(timestamp) at!: string;
}
class DecideCanDto {
  @ApiProperty({ type: Boolean }) decide!: boolean;
}
export class QueueItemDetailDto extends QueueItemDto {
  @ApiProperty({ type: [PropertyDto] }) properties!: PropertyDto[];
  @ApiProperty({ type: UserRefDto, nullable: true }) reporter!: UserRefDto | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) topicId!: string | null;
  @ApiProperty({ type: [SectionKeyDto] }) downstream!: SectionKeyDto[];
  @ApiProperty({ type: [DecisionRecordDto] }) decisions!: DecisionRecordDto[];
  @ApiProperty({ type: DecideCanDto }) can!: DecideCanDto;
}
class PageLabelDto {
  @ApiProperty({ enum: LABEL_ORDER }) label!: Label;
  @ApiProperty(labelCounts) spread!: Record<Label, number>;
}
class OldestUncheckedDto {
  @ApiProperty({ type: String }) anchor!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ ...timestamp, nullable: true }) since!: string | null;
}
export class CredibilityPageDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: PageLabelDto }) pageLabel!: PageLabelDto;
  @ApiProperty({ type: OldestUncheckedDto, nullable: true }) oldestUnchecked!: OldestUncheckedDto | null;
  @ApiProperty({ type: 'integer' }) activeReaders30d!: number;
}
class TileDto {
  @ApiProperty({ type: 'integer' }) sections!: number;
  @ApiProperty({ type: 'integer' }) changeThisWeek!: number;
}
const tiles = {
  type: 'object',
  properties: Object.fromEntries(
    LABEL_ORDER.map((l) => [
      l,
      {
        type: 'object',
        properties: { sections: { type: 'integer' }, changeThisWeek: { type: 'integer' } },
        required: ['sections', 'changeThisWeek'],
      },
    ]),
  ),
  required: [...LABEL_ORDER],
  selfRequired: true,
  additionalProperties: false,
} as const;
export class CredibilityPagesDto {
  @ApiProperty({ type: [CredibilityPageDto] }) items!: CredibilityPageDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
  @ApiProperty(tiles as never) tiles!: Record<Label, TileDto>;
}
class LastCheckDto {
  @ApiProperty(timestamp) at!: string;
  @ApiProperty({ type: String }) result!: string;
}
export class CredibilitySourceDto {
  @ApiProperty({ type: String }) ref!: string;
  @ApiProperty(nullableString) name!: string | null;
  @ApiProperty({ enum: SOURCE_TIERS, nullable: true }) tier!: (typeof SOURCE_TIERS)[number] | null;
  @ApiProperty({ enum: SOURCE_STATES }) state!: (typeof SOURCE_STATES)[number];
  @ApiProperty({ type: 'integer' }) citedBy!: number;
  @ApiProperty({ type: LastCheckDto, nullable: true }) lastCheck!: LastCheckDto | null;
}
export class CredibilitySourcesDto {
  @ApiProperty({ type: [CredibilitySourceDto] }) items!: CredibilitySourceDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
}
export class IdDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
}
export class InvalidationResultDto extends IdDto {
  @ApiProperty({ type: [SectionKeyDto] }) affected!: SectionKeyDto[];
}
const activityCounts = {
  type: 'object',
  properties: Object.fromEntries(ACTIVITY_KINDS.map((k) => [k, { type: 'integer' }])),
  required: [...ACTIVITY_KINDS],
  selfRequired: true,
  additionalProperties: false,
} as const;
export class ActivityDto {
  @ApiProperty({ type: [AttestationDto] }) items!: AttestationDto[];
  @ApiProperty(nullableString) nextCursor!: string | null;
  @ApiProperty(activityCounts as never) counts!: Record<(typeof ACTIVITY_KINDS)[number], number>;
}
export class SummaryDto {
  @ApiProperty({ type: 'integer' }) year!: number;
  @ApiProperty({ type: 'integer' }) checksCounting!: number;
  @ApiProperty({ type: 'integer' }) reportsConfirmed!: number;
  @ApiProperty({ type: 'integer' }) suggestionsPublished!: number;
}
class GateReferenceDto {
  @ApiProperty({ type: String }) runRecord!: string;
  @ApiProperty({ type: String, format: 'date' }) runDate!: string;
}
export class CredibilityGateDto {
  @ApiProperty({ enum: GATE_CAPABILITIES }) capability!: (typeof GATE_CAPABILITIES)[number];
  @ApiProperty({ enum: ['E8b', 'E8c', 'E8d'] }) experiment!: 'E8b' | 'E8c' | 'E8d';
  @ApiProperty({ type: Boolean }) enabled!: boolean;
  @ApiProperty({ type: GateReferenceDto, nullable: true }) reference!: GateReferenceDto | null;
  @ApiProperty({ ...timestamp, nullable: true }) updatedAt!: string | null;
  @ApiProperty({ type: UserRefDto, nullable: true }) updatedBy!: UserRefDto | null;
  @ApiProperty({ type: String }) description!: string;
}
export class CredibilityGatesDto {
  @ApiProperty({ type: [CredibilityGateDto] }) items!: CredibilityGateDto[];
}
class PurgedDto {
  @ApiProperty({ type: 'integer' }) attestations!: number;
  @ApiProperty({ type: 'integer' }) feedback!: number;
}
export class MaintenanceDto {
  @ApiProperty({ type: PurgedDto }) purged!: PurgedDto;
  @ApiProperty({ type: 'integer' }) pairs!: number;
  @ApiProperty({ type: 'integer' }) digests!: number;
}
