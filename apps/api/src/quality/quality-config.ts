import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { parseQualityRules, sha256Hex, type QualityRules, type Result } from '@md-wiki/domain';
import { API_CONFIG, REPO_ROOT, type ApiConfig } from '../config/env.js';

export interface RulesFile {
  /** Repo-relative path shown to people and sent to the worker. */
  path: string;
  raw: Buffer | null;
  parsed: Result<QualityRules, string>;
}

/** The API is the only reader of the rules file (system-logic §7.6.2, D-132). */
@Injectable()
export class QualityRulesFile {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  get path(): string {
    const rel = relative(REPO_ROOT, this.config.QUALITY_RULES_PATH);
    return rel && !rel.startsWith('..') ? rel : this.config.QUALITY_RULES_PATH;
  }

  async read(): Promise<RulesFile> {
    let raw: Buffer;
    try {
      raw = await readFile(this.config.QUALITY_RULES_PATH);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'unreadable';
      return { path: this.path, raw: null, parsed: { ok: false, error: `cannot read (${code})` } };
    }
    return { path: this.path, raw, parsed: parseQualityRules(raw) };
  }
}

export const sha = (raw: Uint8Array) => sha256Hex(raw);

// Worker defaults (services/worker providers/settings.py, §7.3).
const DEFAULTS = {
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  maxTokens: 4096,
  timeoutS: 120,
  maxAttempts: 3,
};
type ModelEnv = Pick<
  ApiConfig,
  | 'AI_DEFAULT__PROVIDER'
  | 'AI_DEFAULT__MODEL'
  | 'AI_DEFAULT__MAX_TOKENS'
  | 'AI_DEFAULT__TIMEOUT_S'
  | 'AI_DEFAULT__MAX_ATTEMPTS'
  | 'AI_JOBS__QUALITY_CHECK__PROVIDER'
  | 'AI_JOBS__QUALITY_CHECK__MODEL'
  | 'AI_JOBS__QUALITY_CHECK__MAX_TOKENS'
  | 'AI_JOBS__QUALITY_CHECK__TIMEOUT_S'
  | 'AI_JOBS__QUALITY_CHECK__MAX_ATTEMPTS'
  | 'OPENAI_COMPAT_BASE_URL'
>;

const text = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);
const number = (value: string | undefined) => {
  const n = Number(text(value));
  return text(value) !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
};

/** scheme://host:port of a URL, never its credentials or path (§7.6.7). */
export function redactUrl(url: string | undefined): string | null {
  if (!text(url)) return null;
  try {
    const parsed = new URL(text(url) ?? '');
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '<invalid-url>';
  }
}

/** The `quality_check` model config as the worker would resolve it from the shared env (D-140). */
export function qualityModelConfig(env: ModelEnv) {
  const base = {
    provider: text(env.AI_DEFAULT__PROVIDER) ?? DEFAULTS.provider,
    model: text(env.AI_DEFAULT__MODEL) ?? DEFAULTS.model,
    maxTokens: number(env.AI_DEFAULT__MAX_TOKENS) ?? DEFAULTS.maxTokens,
    timeoutS: number(env.AI_DEFAULT__TIMEOUT_S) ?? DEFAULTS.timeoutS,
    maxAttempts: number(env.AI_DEFAULT__MAX_ATTEMPTS) ?? DEFAULTS.maxAttempts,
  };
  const override = {
    provider: text(env.AI_JOBS__QUALITY_CHECK__PROVIDER),
    model: text(env.AI_JOBS__QUALITY_CHECK__MODEL),
    maxTokens: number(env.AI_JOBS__QUALITY_CHECK__MAX_TOKENS),
    timeoutS: number(env.AI_JOBS__QUALITY_CHECK__TIMEOUT_S),
    maxAttempts: number(env.AI_JOBS__QUALITY_CHECK__MAX_ATTEMPTS),
  };
  return {
    kind: 'quality_check' as const,
    provider: override.provider ?? base.provider,
    model: override.model ?? base.model,
    maxTokens: override.maxTokens ?? base.maxTokens,
    timeoutS: override.timeoutS ?? base.timeoutS,
    maxAttempts: override.maxAttempts ?? base.maxAttempts,
    overridden: Object.values(override).some((v) => v !== undefined),
  };
}
