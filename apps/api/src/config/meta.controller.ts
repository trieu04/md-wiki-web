import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { API_CONFIG, type ApiConfig } from './env.js';

class MetaDto {
  @ApiProperty({ type: String }) readonly wikiName: string;
  @ApiProperty({ type: String }) readonly wikiDescription: string;

  constructor(wikiName: string, wikiDescription: string) {
    this.wikiName = wikiName;
    this.wikiDescription = wikiDescription;
  }
}

@Controller('meta')
export class MetaController {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  @Get()
  @ApiOkResponse({ type: MetaDto })
  get(): MetaDto {
    return new MetaDto(this.config.WIKI_NAME, this.config.WIKI_DESCRIPTION);
  }
}
