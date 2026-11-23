import { expect, it } from 'vitest';
import { themeTokens } from '../src/ui/theme-tokens';

it('lists the design-system §2 tokens and the exact frame additions in §2.4', () => {
  expect(themeTokens).toMatchSnapshot();
});
