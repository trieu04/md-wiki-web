import { ApiProperty } from '@nestjs/swagger';

export type DependencyStatus = 'ok' | 'down';
const dependency = { enum: ['ok', 'down'] };

export class HealthDto {
  @ApiProperty({ enum: ['ok'] }) readonly status = 'ok';
  @ApiProperty(dependency) readonly db: DependencyStatus;
  @ApiProperty(dependency) readonly redis: DependencyStatus;
  @ApiProperty(dependency) readonly storage: DependencyStatus;
  @ApiProperty({ type: String }) readonly version: string;

  constructor(
    db: DependencyStatus,
    redis: DependencyStatus,
    storage: DependencyStatus,
    version: string,
  ) {
    this.db = db;
    this.redis = redis;
    this.storage = storage;
    this.version = version;
  }
}
