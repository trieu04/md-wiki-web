import { ApiProperty } from '@nestjs/swagger';
import { QUALITY_FLAGS, type QualityFlag } from '@md-wiki/domain';

/** The quality summary on proposal rows (system-logic §7.6.4); no imports from review DTOs. */
export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export const SUMMARY_STATUSES = ['none', ...RUN_STATUSES] as const;

export class SeverityCountsDto {
  @ApiProperty({ type: 'integer' }) info!: number;
  @ApiProperty({ type: 'integer' }) warning!: number;
  @ApiProperty({ type: 'integer' }) blocking!: number;
}
export class QualitySummaryDto {
  @ApiProperty({ enum: SUMMARY_STATUSES, enumName: 'QualityStatus' })
  status!: (typeof SUMMARY_STATUSES)[number];
  @ApiProperty({ type: 'integer', description: 'Findings of the current run' }) findings!: number;
  @ApiProperty({ type: SeverityCountsDto }) counts!: SeverityCountsDto;
  @ApiProperty({ enum: QUALITY_FLAGS, enumName: 'QualityFlag', isArray: true })
  flags!: QualityFlag[];
  @ApiProperty({ type: Boolean, description: 'A succeeded run bound to the current hash exists' })
  current!: boolean;
}
