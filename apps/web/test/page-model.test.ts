import { describe, expect, it } from 'vitest';
import { visualHistory, visualPage, visualPageTopic } from '../src/dev/fixtures/reading';
import type { PageDto } from '../src/features/markdown/model';
import {
  historyModel,
  pageArticleModel,
  pageHeaderModel,
  topicModel,
} from '../src/features/page/model';

const noSpread = { checked: 0, reviewed: 0, recheck: 0, error: 0, not_reviewed: 0 };

describe('reading view models', () => {
  it('maps the F-03 maintainer/date/usage line and the full page label distribution', () => {
    expect(pageHeaderModel(visualPage)).toMatchObject({
      maintainers: 'Maintained by m.nguyen and h.pham',
      updated: 'updated 23 Nov',
      usedBy: 'used by 4 teams',
      label: 'recheck',
      status: '1 section under re-check',
      spread: {
        counts: visualPage.pageLabel.spread,
        ariaLabel: '5 sections: 1 checked, 2 reviewed, 1 under re-check, 1 not reviewed',
        caption: '1 checked · 2 reviewed · 1 not reviewed',
      },
    });
  });

  it('does not fabricate maintenance, usage or distribution information when absent', () => {
    const header = pageHeaderModel({
      ...visualPage,
      maintainers: [],
      usedByTeams: null,
      pageLabel: { label: 'not_reviewed', spread: noSpread },
    });
    expect(header).toMatchObject({
      maintainers: null,
      usedBy: null,
      status: 'Not reviewed',
      spread: null,
    });
    expect(
      pageHeaderModel({ ...visualPage, maintainers: [{ name: 'm.nguyen' }], usedByTeams: 1 }),
    ).toMatchObject({
      maintainers: 'Maintained by m.nguyen',
      usedBy: 'used by 1 team',
    });
  });

  it('keeps the page label authoritative when several warning labels occur', () => {
    const header = pageHeaderModel({
      ...visualPage,
      pageLabel: {
        label: 'error',
        spread: { ...noSpread, error: 2, recheck: 2 },
      },
    });
    expect(header.status).toBe('2 sections with confirmed errors');
    expect(header.spread?.caption).toBe('2 under re-check');
  });

  it('keeps API topic order, labels and exact current paths; encodes nested wiki URLs', () => {
    const path = 'Lab/日本 語 #%?.md';
    const page = { ...visualPage, path };
    const [first, ...rest] = visualPageTopic.pages;
    if (!first) throw new Error('Missing first sibling');
    const wrongTopic = { ...visualPageTopic, id: 'other' };
    const model = topicModel(page, {
      topics: [wrongTopic, { ...visualPageTopic, pages: [{ ...first, path }, ...rest] }],
    });
    expect(model.links.map(({ title }) => title)).toEqual(
      visualPageTopic.pages.map(({ title }) => title),
    );
    expect(model.links[0]).toMatchObject({
      href: '/wiki/Lab/%E6%97%A5%E6%9C%AC%20%E8%AA%9E%20%23%25%3F.md',
      label: 'recheck',
      current: 'page',
    });
    expect(pageHeaderModel(page).historyHref).toBe(
      '/wiki/Lab/%E6%97%A5%E6%9C%AC%20%E8%AA%9E%20%23%25%3F.md/history',
    );
    expect(model.links.slice(1).every(({ current }) => current == null)).toBe(true);
    expect(topicModel(page, { topics: [wrongTopic] }).links).toEqual([]);
  });

  it('uses API anchors for the contents and headings including duplicate titles and a headingless lead', () => {
    const [overview] = visualPage.sections;
    if (!overview) throw new Error('Missing section fixture');
    const page = {
      ...visualPage,
      markdown: 'Intro\n\n## Overview\n\nParagraph 1\n\nOverview\n--------\n\nParagraph 2',
      sections: [
        { ...overview, title: 'Lead', anchor: 'lead', level: 0 },
        { ...overview, anchor: 'api-1' },
        { ...overview, anchor: '見出し-2' },
      ],
    };
    const model = pageArticleModel(page);
    expect(model.defaultAnchor).toBe('');
    expect(model.links.map(({ anchor, label }) => [anchor, label])).toEqual([
      ['lead', 'reviewed'],
      ['api-1', 'reviewed'],
      ['見出し-2', 'reviewed'],
    ]);
    expect(
      model.markdown.groups.map(({ section, heading }) => [section?.anchor, heading?.tagName]),
    ).toEqual([
      ['lead', undefined],
      ['api-1', 'h2'],
      ['見出し-2', 'h2'],
    ]);
    expect(pageArticleModel({ ...page, markdown: '\r\n', sections: [] }).empty).toBe(true);
  });

  it('uses the provided warning reason, confirmed-error copy and optional proposal link', () => {
    const model = pageArticleModel(visualPage);
    expect(model.defaultAnchor).toBe('principle');
    expect(model.markdown.groups.map(({ warning }) => !!warning)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(model.markdown.groups[1]?.warning).toMatchObject({
      title: 'Use with care: this section is being re-checked.',
      fixHref: '/work/proposals/confocal-pinhole-wording',
      reason: visualPage.sections[1]?.warn?.reason,
    });
    const sections = visualPage.sections.map((section): PageDto['sections'][number] =>
      !section.warn
        ? section
        : {
            ...section,
            warn: { reason: 'Wrong value', fixProposalSlug: null },
            label: { ...section.label, label: 'error' },
          },
    );
    expect(pageArticleModel({ ...visualPage, sections }).markdown.groups[1]?.warning).toEqual({
      title: 'Use with care: this section contains a confirmed error.',
      reason: 'Wrong value',
      fixHref: null,
    });
  });
});

it('keeps newest-first history across cursor pages and formats capture times in UTC', () => {
  const [current] = visualHistory.items;
  if (!current) throw new Error('Missing history item');
  const older = { ...current, versionLabel: '20261122-1', capturedAt: '2026-11-22T18:04:00Z' };
  expect(
    historyModel([
      { ...visualHistory, nextCursor: 'opaque' },
      { nextCursor: null, items: [older] },
    ]),
  ).toEqual([
    { ...current, captured: '23 Nov 2026, 00:00 UTC' },
    { ...older, captured: '22 Nov 2026, 18:04 UTC' },
  ]);
  expect(historyModel([{ items: [], nextCursor: null }])).toEqual([]);
});
