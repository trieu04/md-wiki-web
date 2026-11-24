import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import type { Label } from '@md-wiki/domain';
import { describe, expect, it } from 'vitest';
import { themeTokens } from '../src/ui/theme-tokens';
import { TrustBadge } from '../src/ui/TrustBadge';
import { TrustIcon } from '../src/ui/TrustIcon';

// P10-03 (D-252): contrast of the token pairs the screens use, and label shapes that do not rely on colour.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg: string, bg: string): number {
  const color = (name: string) => {
    const value = themeTokens[`--color-${name}`];
    if (!value?.startsWith('#') || value.length !== 7) throw new Error(`no hex token ${name}`);
    return value;
  };
  const [a, b] = [luminance(color(fg)), luminance(color(bg))].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (a + 0.05) / (b + 0.05);
}

const backgrounds = [
  'surface',
  'canvas',
  'selected',
  'subtle-section',
  'subtle-gutter',
  'nav-current',
];

describe('text contrast ≥ 4.5:1 (WCAG 1.4.3)', () => {
  it.each(['primary', 'secondary', 'muted', 'trust-none', 'accent'])(
    '%s on every page background',
    (fg) => {
      for (const bg of backgrounds)
        expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([
    ['trust-checked-fg', 'trust-checked-bg'],
    ['trust-reviewed-fg', 'trust-reviewed-bg'],
    ['trust-recheck-fg', 'trust-recheck-bg'],
    ['trust-recheck-note-fg', 'trust-recheck-bg'],
    ['trust-error-fg', 'trust-error-bg'],
    ['trust-error-action-fg', 'trust-error-bg'],
    ['ai', 'ai-bg'],
    ['disabled-fg', 'disabled-bg'],
    ['surface', 'accent'],
    ['surface', 'accent-hover'],
  ])('%s on %s', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('trust labels do not rely on colour (WCAG 1.4.1, 1.4.11)', () => {
  const labels: Label[] = ['checked', 'reviewed', 'not_reviewed', 'recheck', 'error'];

  it('draws a different shape for every label', () => {
    const shapes = labels.map((label) => {
      const { container } = render(<TrustIcon label={label} />);
      return [...container.querySelectorAll('path')]
        .map((path) => path.getAttribute('d'))
        .join('|');
    });
    expect(new Set(shapes).size).toBe(labels.length);
  });

  it('icon colours reach 3:1 against the surface', () => {
    for (const icon of [
      'trust-checked',
      'trust-reviewed',
      'trust-none',
      'trust-recheck',
      'trust-error',
    ])
      expect(contrast(icon, 'surface'), icon).toBeGreaterThanOrEqual(3);
  });

  it('always pairs the icon with words', () => {
    for (const label of labels) {
      const { container, unmount } = render(<TrustBadge variant="inline" label={label} />);
      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(container.textContent.trim().length).toBeGreaterThan(4);
      unmount();
    }
  });
});
