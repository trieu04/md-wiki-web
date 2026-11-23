import { applyDecorators } from '@nestjs/common';
import { LABEL_ORDER, type Label } from '@md-wiki/domain';
import { ApiParam, ApiProperty, ApiQuery, type ApiPropertyOptions } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

// The DTO classes describe OpenAPI, while these handlers return plain JSON objects.
export type Wire<T> = T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

const sorts = ['relevance', 'trust', 'recent'] as const;
const windows = ['any', '30d', '1y'] as const;
const scopes = ['all', 'mine'] as const;
export const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_QUERY = 200;

function repeated({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? [value] : (value as unknown);
}
class LimitInput {
  @IsOptional()
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : (value as unknown),
  )
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}
export class SnapshotPageInput extends LimitInput {
  @IsOptional() @IsUUID() cursor?: string;
}
export class RecentInput extends SnapshotPageInput {
  @IsOptional() @IsIn(scopes) scope?: (typeof scopes)[number];
}
export class TreeInput {
  @IsOptional() @IsString() topic?: string;
}
export class ContextInput {
  // The domain path validator owns the INVALID_PATH error, including missing input.
  @Allow() path?: unknown;
}
export class SearchInput extends LimitInput {
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @Length(1, MAX_QUERY)
  q!: string;
  @IsOptional() @IsIn(sorts) sort?: (typeof sorts)[number];
  @IsOptional() @IsIn(windows) updated?: (typeof windows)[number];
  @IsOptional()
  @Transform(repeated)
  @IsArray()
  @IsIn(LABEL_ORDER, { each: true })
  'labels[]'?: Label[];
  @IsOptional()
  @Transform(repeated)
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  'topics[]'?: string[];
  @IsOptional() @IsString() @Matches(/^[\w-]+$/) cursor?: string;
}

export const apiPagination = (uuid = false) =>
  applyDecorators(
    ApiQuery({
      name: 'cursor',
      required: false,
      schema: { type: 'string', ...(uuid && { format: 'uuid' }) },
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
    }),
  );
export const apiWikiPath = () =>
  ApiParam({ name: 'path', type: String, description: 'URL-encoded wiki path' });
export const apiRecentScope = () =>
  ApiQuery({ name: 'scope', enum: scopes, required: false, schema: { default: 'all' } });
export const apiSearchQuery = () =>
  applyDecorators(
    apiPagination(),
    ApiQuery({ name: 'q', schema: { type: 'string', minLength: 1, maxLength: MAX_QUERY } }),
    ApiQuery({ name: 'sort', enum: sorts, required: false, schema: { default: 'relevance' } }),
    ApiQuery({ name: 'updated', enum: windows, required: false, schema: { default: 'any' } }),
    ApiQuery({
      name: 'labels[]',
      enum: LABEL_ORDER,
      isArray: true,
      required: false,
      style: 'form',
      explode: true,
    }),
    ApiQuery({ name: 'topics[]', type: [String], required: false, style: 'form', explode: true }),
  );

const timestamp = { type: String, format: 'date-time' } as const;
const nullableString = { type: String, nullable: true } as const;
const nullableCount = { type: 'integer', nullable: true } as const;
export const labelCounts = {
  type: 'object',
  properties: Object.fromEntries(LABEL_ORDER.map((label) => [label, { type: 'integer' }])),
  required: [...LABEL_ORDER],
  selfRequired: true,
  additionalProperties: false,
} satisfies ApiPropertyOptions;

export class LabelDto {
  @ApiProperty({ enum: LABEL_ORDER }) label!: Label;
  @ApiProperty({ ...timestamp, nullable: true }) since!: string | null;
  @ApiProperty({ enum: ['agent', 'person'], nullable: true }) reviewerKind!:
    'agent' | 'person' | null;
  @ApiProperty(nullableString) reason!: string | null;
}
class SectionWarningDto {
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty(nullableString) fixProposalSlug!: string | null;
}
export class SectionDto {
  @ApiProperty({ type: String }) anchor!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 6 }) level!: number;
  @ApiProperty({ type: String }) hash!: string;
  @ApiProperty({ type: LabelDto }) label!: LabelDto;
  @ApiProperty({ type: SectionWarningDto, nullable: true }) warn!: SectionWarningDto | null;
}
class PageLabelDto {
  @ApiProperty({ enum: LABEL_ORDER }) label!: Label;
  @ApiProperty(labelCounts) spread!: Record<Label, number>;
}
class TopicDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}
class MaintainerDto {
  @ApiProperty({ type: String }) name!: string;
}
export class PageSummaryDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: PageLabelDto }) pageLabel!: PageLabelDto;
  @ApiProperty(timestamp) updatedAt!: string;
}
export class PageDto extends PageSummaryDto {
  @ApiProperty({ type: TopicDto }) topic!: TopicDto;
  @ApiProperty({ type: String }) versionLabel!: string;
  @ApiProperty({ type: String }) sha256!: string;
  @ApiProperty({ type: Boolean }) changedOutsideReview!: boolean;
  @ApiProperty({ type: String }) markdown!: string;
  @ApiProperty({ type: [SectionDto] }) sections!: SectionDto[];
  @ApiProperty({ type: [MaintainerDto] }) maintainers!: MaintainerDto[];
  @ApiProperty(nullableCount) usedByTeams!: number | null;
}
export class TreeTopicDto extends TopicDto {
  @ApiProperty({ type: 'integer' }) pageCount!: number;
  @ApiProperty({ type: [PageSummaryDto] }) pages!: PageSummaryDto[];
}
export class TreeDto {
  @ApiProperty({ type: [TreeTopicDto] }) topics!: TreeTopicDto[];
}
export class ContextDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) versionLabel!: string;
  @ApiProperty({ type: String }) sha256!: string;
  @ApiProperty({ type: String }) content!: string;
  @ApiProperty({ type: [SectionDto] }) sections!: SectionDto[];
}
class CursorDto {
  @ApiProperty(nullableString) nextCursor!: string | null;
}
/** The reviewed publication that produced a version (system-logic §7.4.10). */
export class VersionPublicationDto {
  @ApiProperty({ type: String }) proposalSlug!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty(nullableString) sectionTitle!: string | null;
  @ApiProperty({ enum: ['agent', 'person'] }) reviewerKind!: 'agent' | 'person';
  @ApiProperty(timestamp) decidedAt!: string;
  @ApiProperty(timestamp) publishedAt!: string;
  @ApiProperty({ type: Boolean }) auto!: boolean;
}
class VersionDto {
  @ApiProperty({ type: String }) versionLabel!: string;
  @ApiProperty({ type: String }) sha256!: string;
  @ApiProperty(timestamp) capturedAt!: string;
  @ApiProperty({ type: VersionPublicationDto, nullable: true })
  publication!: VersionPublicationDto | null;
}
export class HistoryDto extends CursorDto {
  @ApiProperty({ type: [VersionDto] }) items!: VersionDto[];
}
class RecentChangeDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty({ type: String }) versionLabel!: string;
  @ApiProperty(timestamp) at!: string;
  @ApiProperty({ type: Boolean }) changedOutsideReview!: boolean;
  @ApiProperty(nullableString) proposalSlug!: string | null;
  @ApiProperty(nullableString) sectionTitle!: string | null;
  @ApiProperty(nullableString) summary!: string | null;
}
export class RecentDto extends CursorDto {
  @ApiProperty({ type: [RecentChangeDto] }) items!: RecentChangeDto[];
}
class TopicFacetDto extends TopicDto {
  @ApiProperty({ type: 'integer' }) n!: number;
}
class SearchFacetsDto {
  @ApiProperty(labelCounts) labels!: Record<Label, number>;
  @ApiProperty({ type: [TopicFacetDto] }) topics!: TopicFacetDto[];
}
export class SnippetDto {
  @ApiProperty({ type: String }) before!: string;
  @ApiProperty({ type: String }) hit!: string;
  @ApiProperty({ type: String }) after!: string;
}
class SearchMetaDto {
  @ApiProperty(timestamp) updatedAt!: string;
  @ApiProperty(nullableCount) checkedBy!: number | null;
  @ApiProperty(nullableString) sourceName!: string | null;
  @ApiProperty(nullableCount) usedByTeams!: number | null;
}
class SearchHitDto {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) pageTitle!: string;
  @ApiProperty({ type: String }) anchor!: string;
  @ApiProperty({ type: String }) sectionTitle!: string;
  @ApiProperty({ type: LabelDto }) label!: LabelDto;
  @ApiProperty({ type: [SnippetDto], maxItems: 2 }) snippet!: SnippetDto[];
  @ApiProperty({ type: SearchMetaDto }) meta!: SearchMetaDto;
}
export class SearchDto extends CursorDto {
  @ApiProperty({ type: 'integer' }) total!: number;
  @ApiProperty({ type: 'integer' }) pageCount!: number;
  @ApiProperty({ type: SearchFacetsDto }) facets!: SearchFacetsDto;
  @ApiProperty({ type: [SearchHitDto] }) items!: SearchHitDto[];
}
