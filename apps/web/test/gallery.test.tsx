import '@testing-library/jest-dom/vitest';
import { createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { crops } from '../../../tools/design-ref/variants.json';
import { App } from '../src/App';
import { createAppRouter } from '../src/router';
import { themeTokens } from '../src/ui/theme-tokens';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('serves the dev gallery with stable, unique wrappers and separates undrawn examples', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/__gallery'] }));
  render(<App router={router} />);
  const gallery = await screen.findByRole('main');
  const tokens = within(gallery).getByRole('region', { name: 'Tokens' });
  const undrawn = within(gallery).getByRole('region', { name: 'Not in frames (§6.1)' });
  expect(within(tokens).getAllByRole('listitem')).toHaveLength(
    Object.keys(themeTokens).filter((token) => token.startsWith('--color-')).length,
  );
  const ids = Array.from(gallery.querySelectorAll('[data-gallery]'), (node) =>
    node.getAttribute('data-gallery'),
  );
  expect(new Set(ids).size).toBe(ids.length);
  const cropped = new Set(
    Object.entries(crops).map(([id, crop]) => ('gallery' in crop ? crop.gallery : id)),
  );
  for (const id of cropped) {
    const sample = gallery.querySelector<HTMLElement>(`[data-gallery="${id}"]`);
    expect(sample, id).toBeInTheDocument();
    expect(undrawn, id).not.toContainElement(sample);
  }
  for (const sample of undrawn.querySelectorAll('[data-gallery]')) {
    expect(cropped.has(sample.getAttribute('data-gallery') ?? '')).toBe(false);
  }
  expect(undrawn.querySelectorAll('[data-gallery^="TrustIcon/"]')).toHaveLength(4);
  expect(within(undrawn).getByRole('button', { busy: true })).toBeDisabled();
});
