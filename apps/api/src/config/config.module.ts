import { Global, Module } from '@nestjs/common';
import { API_CONFIG, loadConfig } from './env.js';

@Global()
@Module({ providers: [{ provide: API_CONFIG, useFactory: loadConfig }], exports: [API_CONFIG] })
export class ConfigModule {}
