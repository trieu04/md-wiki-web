import { describe, expect, it } from 'vitest';
import { contractsPlaceholder } from '../src/index.js';

describe('contracts package placeholder', () => {
  it('exports its package identifier', () => {
    expect(contractsPlaceholder).toBe('md-wiki-contracts');
  });
});
