import assert from 'node:assert/strict';
import { URL } from 'node:url';

const path = '/wiki/confocal-microscopy.md';
const ready = 'main article[aria-label="Confocal microscopy"]';
export const pageReadingCases = ['principle', 'overview', 'resolution', 'detectors', 'history'].map(
  (anchor) => ({
    frame: 'Page',
    variant: `${anchor}-reading`,
    path,
    ready,
    topBarSelector: 'header:has(nav[aria-label="Wiki"])',
    async prepare(page) {
      const nav = page.getByRole('navigation', { name: 'Pages and contents' });
      await nav.getByRole('link', { name: 'Confocal microscopy: Under re-check' }).waitFor();
      assert.equal(
        await page.getByRole('link', { name: 'Browse', exact: true }).getAttribute('href'),
        path,
      );
      // Principle is the frame's initial state: capture it without selecting a section first.
      if (anchor === 'resolution') {
        await page.locator('#resolution').getByRole('button').click();
      } else if (anchor === 'history') {
        await page.locator('section#history').getByRole('button').press('Space');
      } else if (anchor !== 'principle') {
        await nav.locator(`a[href$="#${anchor}"]`).click();
      }
      await nav.locator(`a[aria-current="location"][href$="#${anchor}"]`).waitFor();
      assert.equal(new URL(page.url()).hash, anchor === 'principle' ? '' : `#${anchor}`);
    },
  }),
);

export const pageHistoryCapture = {
  name: 'History · DV-5',
  path: `${path}/history`,
  ready: 'main table[aria-label="Versions"]',
  height: 1350,
  async prepare(page) {
    await page.getByRole('link', { name: 'Confocal microscopy: Under re-check' }).waitFor();
  },
};
