import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ERROR_STATUS } from '@md-wiki/domain';
import type { ErrorCode } from '@md-wiki/domain';
import type { FieldProblem } from './app-error.js';

class FieldProblemDto implements FieldProblem {
  @ApiProperty({ type: String }) path!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) message!: string;
}

export class ProblemDto {
  @ApiProperty({ type: String }) type!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: 'integer' }) status!: number;
  @ApiProperty({ enum: Object.keys(ERROR_STATUS), enumName: 'ErrorCode' }) code!: ErrorCode;
  @ApiPropertyOptional({ type: String }) detail?: string;
  @ApiProperty({ type: String }) requestId!: string;
  @ApiPropertyOptional({ type: [FieldProblemDto] }) fields?: FieldProblemDto[];
}

export function ApiProblemResponse(code: ErrorCode) {
  return applyDecorators(
    ApiExtraModels(ProblemDto),
    ApiResponse({
      status: ERROR_STATUS[code],
      description: code,
      content: { 'application/problem+json': { schema: { $ref: getSchemaPath(ProblemDto) } } },
    }),
  );
}
