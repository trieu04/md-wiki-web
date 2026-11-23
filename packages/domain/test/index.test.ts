import { describe, expect, it } from 'vitest';
import { domainPlaceholder } from '../src/index.js';

describe('domain package placeholder', () => {
  it('exports its package identifier', () => {
    expect(domainPlaceholder).toBe('md-wiki-domain');
  });
});
