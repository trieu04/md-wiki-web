import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const provided = (_: unknown, v: unknown) => v !== undefined;
const timestamp = { type: String, format: 'date-time' } as const;
const nullableString = { type: String, nullable: true } as const;
const states = ['pending', 'approved', 'published', 'rejected', 'stale'] as const;
const origins = ['editor', 'api', 'import'] as const;
const VERSION = /^\d{8}-\d+$/;
const HASH = /^[a-f0-9]{64}$/;
const NON_BLANK = /\S/;
export const CONTENT_LIMIT = 1024 * 1024;
export type ProposalState = (typeof states)[number];

// ---- inputs -------------------------------------------------------------------------------

export class AppliesToInput {
  @ApiProperty({ type: String, maxLength: 100 })
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(100)
  name!: string;
  @ApiProperty({ type: String, maxLength: 50 })
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(50)
  version!: string;
}
export class CreateDraftInput {
  // The domain path validator owns INVALID_PATH, including a missing value.
  @ApiProperty({ type: String }) @Allow() targetPath!: unknown;
  @ApiPropertyOptional({ ...nullableString })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(200)
  section?: string | null;
}
class ScopeInput {
  @ApiProperty({ type: String, nullable: true, description: 'Only null (whole page) is accepted' })
  @IsIn([null], { message: 'only null (whole page) is accepted' })
  section!: null;
}
export class UpdateDraftInput {
  @ApiPropertyOptional({ type: String }) @ValidateIf(provided) @IsString() content?: string;
  @ApiPropertyOptional({ type: String, maxLength: 4000 })
  @ValidateIf(provided)
  @IsString()
  @MaxLength(4000)
  reason?: string;
  @ApiPropertyOptional({ type: String, maxLength: 120 })
  @ValidateIf(provided)
  @IsString()
  @MaxLength(120)
  title?: string;
  @ApiPropertyOptional({ type: [AppliesToInput], maxItems: 16 })
  @ValidateIf(provided)
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => AppliesToInput)
  appliesTo?: AppliesToInput[];
  @ApiPropertyOptional({
    type: ScopeInput,
    description: 'Only `{ section: null }` (switch to whole page)',
  })
  @ValidateIf(provided)
  @IsObject()
  @ValidateNested()
  @Type(() => ScopeInput)
  scope?: ScopeInput;
}
export class AddSourceInput {
  @ApiProperty({ type: String }) @Allow() path!: unknown;
}
export class RebaseInput {
  @ApiPropertyOptional({ enum: ['auto', 'keep_mine'], default: 'auto' })
  @ValidateIf(provided)
  @IsIn(['auto', 'keep_mine'])
  mode?: 'auto' | 'keep_mine';
}
export class DraftIdInput {
  @Matches(/^[0-9a-f-]{36}$/i) id!: string;
}
export class CursorInput {
  @IsOptional()
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : (value as unknown),
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @IsOptional() @IsString() @Matches(/^[\w.:-]{1,80}$/) cursor?: string;
}
class BaseRefInput {
  @ApiProperty({ type: String }) @IsString() @Matches(VERSION) versionLabel!: string;
  @ApiProperty({ type: String }) @IsString() @Matches(HASH) sha256!: string;
}
class VersionRefInput {
  @ApiProperty({ type: String }) @IsString() path!: string;
  @ApiProperty({ type: String }) @IsString() @Matches(VERSION) versionLabel!: string;
}
class ScopeRowInput extends VersionRefInput {
  @ApiProperty({ type: String, maxLength: 500 })
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(500)
  impact!: string;
}
export class ContributionInput {
  @ApiProperty({ type: String }) @Allow() targetPath!: unknown;
  @ApiProperty({ type: BaseRefInput, nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => BaseRefInput)
  base!: BaseRefInput | null;
  @ApiProperty({ type: String, description: 'Complete proposed Markdown, no status block' })
  @IsString()
  content!: string;
  @ApiProperty({ type: String, maxLength: 4000 })
  @IsString()
  @Matches(NON_BLANK)
  @MaxLength(4000)
  reason!: string;
  @ApiPropertyOptional({ type: String, maxLength: 120 })
  @ValidateIf(provided)
  @IsString()
  @MaxLength(120)
  title?: string;
  @ApiPropertyOptional({ type: String, maxLength: 80 })
  @ValidateIf(provided)
  @IsString()
  slug?: string;
  @ApiPropertyOptional({ ...nullableString })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  section?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @ValidateIf(provided)
  @IsString()
  @MaxLength(500)
  targetImpact?: string;
  @ApiPropertyOptional({ type: [VersionRefInput], maxItems: 32 })
  @ValidateIf(provided)
  @IsArray()
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => VersionRefInput)
  sources?: VersionRefInput[];
  @ApiPropertyOptional({ type: [ScopeRowInput], maxItems: 32 })
  @ValidateIf(provided)
  @IsArray()
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => ScopeRowInput)
  scope?: ScopeRowInput[];
  @ApiPropertyOptional({ type: [AppliesToInput], maxItems: 16 })
  @ValidateIf(provided)
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => AppliesToInput)
  appliesTo?: AppliesToInput[];
}
export class ImportInput {
  @ApiProperty({ type: String, description: 'The `.contribution.md` v3 file text' })
  @IsString()
  file!: string;
}

// ---- outputs ------------------------------------------------------------------------------

export class PinnedRefDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) versionLabel!: string;
  @ApiProperty({ type: String }) sha256!: string;
}
export class DraftBaseDto extends PinnedRefDto {
  @ApiProperty(timestamp) capturedAt!: string;
}
export class DraftSourceDto extends PinnedRefDto {
  @ApiProperty(timestamp) addedAt!: string;
  @ApiProperty({ type: Boolean }) changed!: boolean;
}
export class AppliesToDto {
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) version!: string;
}
export class DraftDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) targetPath!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty(nullableString) section!: string | null;
  @ApiProperty(nullableString) sectionTitle!: string | null;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) content!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: [AppliesToDto] }) appliesTo!: AppliesToDto[];
  @ApiProperty({ type: DraftBaseDto, nullable: true }) base!: DraftBaseDto | null;
  @ApiProperty({ type: String }) baseText!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) baseStartLine!: number;
  @ApiProperty({ type: PinnedRefDto, nullable: true }) current!: PinnedRefDto | null;
  @ApiProperty({ type: Boolean }) baseChanged!: boolean;
  @ApiProperty({ type: Boolean }) sectionChanged!: boolean;
  @ApiProperty(nullableString) currentText!: string | null;
  @ApiProperty({ type: [DraftSourceDto] }) sources!: DraftSourceDto[];
  @ApiProperty(timestamp) createdAt!: string;
  @ApiProperty(timestamp) updatedAt!: string;
}
export class DraftsDto {
  @ApiProperty(nullableString) nextCursor!: string | null;
  @ApiProperty({ type: [DraftDto] }) items!: DraftDto[];
}
class SubmitterDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: ['human', 'agent'] }) kind!: 'human' | 'agent';
}
export class ScopeRowDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty(nullableString) versionLabel!: string | null;
  @ApiProperty({ type: String }) impact!: string;
}
export class ProposalDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) targetPath!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty(nullableString) section!: string | null;
  @ApiProperty(nullableString) sectionTitle!: string | null;
  @ApiProperty({ enum: states }) state!: ProposalState;
  @ApiProperty({ enum: origins }) origin!: (typeof origins)[number];
  @ApiProperty({ type: SubmitterDto }) submitter!: SubmitterDto;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String }) bundleHash!: string;
  @ApiProperty({ type: String }) proposedSha256!: string;
  @ApiProperty({ type: PinnedRefDto, nullable: true }) base!: PinnedRefDto | null;
  @ApiProperty({ type: [PinnedRefDto] }) sources!: PinnedRefDto[];
  @ApiProperty({ type: [ScopeRowDto] }) scope!: ScopeRowDto[];
  @ApiProperty({ type: [AppliesToDto] }) appliesTo!: AppliesToDto[];
  @ApiProperty(timestamp) createdAt!: string;
}
export class ContributionDto extends ProposalDto {
  @ApiProperty({ type: String, description: 'The frozen manifest bytes as UTF-8 JSON text' })
  manifest!: string;
  @ApiProperty({ type: String }) proposed!: string;
}
export class SuggestionDto {
  @ApiProperty({ enum: ['draft', 'proposal'] }) kind!: 'draft' | 'proposal';
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty(nullableString) slug!: string | null;
  @ApiProperty({ type: String }) targetPath!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty(nullableString) section!: string | null;
  @ApiProperty(nullableString) sectionTitle!: string | null;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ enum: ['draft', ...states] }) state!: 'draft' | ProposalState;
  @ApiProperty({ type: Boolean }) needsAttention!: boolean;
  @ApiProperty(timestamp) at!: string;
}
export class SuggestionsDto {
  @ApiProperty(nullableString) nextCursor!: string | null;
  @ApiProperty({ type: 'integer' }) total!: number;
  @ApiProperty({ type: [SuggestionDto] }) items!: SuggestionDto[];
}
