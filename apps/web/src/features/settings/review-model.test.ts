import { describe, expect, it } from 'vitest';
import {
  reviewDraft,
  reviewRows,
  reviewSettingsInput,
  settingsTab,
  triggerItems,
  type ReviewSettingsDto,
} from './model';

const owner = { id: 'o', name: 'owner', kind: 'human' as const };
const settings = (over: Partial<ReviewSettingsDto> = {}): ReviewSettingsDto => ({
  reviewModel: 'self_managed',
  autoPublish: true,
  spotCheckRate: 0.1,
  reminderDays: 3,
  qualityCheck: { onSubmit: true, rulesPath: 'wiki-meta/quality-rules.md' },
  pageAuthors: {
    order: ['owners_file', 'published_authors', 'owner'],
    ownersFile: { path: 'wiki-meta/owners.md', rules: 2, versionLabel: 'v3', warnings: [] },
  },
  triggers: [
    {
      id: 'wiki_meta',
      title: 'Any change under wiki-meta/',
      description: '',
      enabled: true,
      optional: false,
      source: 'default',
      match: null,
    },
    {
      id: 'agent_edits_human_pages',
      title: 'An agent edits a page written by people',
      description: '',
      enabled: true,
      optional: true,
      source: 'default',
      match: null,
    },
    {
      id: 'custom:lasers',
      title: 'Laser safety',
      description: '',
      enabled: true,
      optional: false,
      source: 'custom',
      match: { kind: 'path', value: 'safety/' },
    },
  ],
  agent: {
    user: { id: 'a', name: 'reviewer-agent', kind: 'agent' },
    available: true,
    paused: false,
    pausedAt: null,
    pausedBy: null,
    pauseReason: null,
    tokenConfigured: true,
  },
  updatedAt: null,
  updatedBy: null,
  ...over,
});

describe('F-14 Review and publishing', () => {
  it('is an implemented tab', () => {
    expect(settingsTab('review')).toBe('review');
  });

  it('shows the agent, auto-publish, page authors and quality rows', () => {
    const rows = reviewRows(settings());
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['agent', 'reviewer-agent · running'],
      ['auto-publish', 'AUTO_PUBLISH=true'],
      [
        'page-authors',
        'wiki-meta/owners.md, then people whose changes were published, then the owner',
      ],
      ['quality', 'On every submission'],
    ]);
    expect(rows[2]?.note).toBe('2 rules in wiki-meta/owners.md · v3');
  });

  it('explains a paused agent and a missing token', () => {
    const paused = reviewRows(
      settings({
        agent: {
          ...settings().agent,
          paused: true,
          pausedBy: owner,
          pausedAt: null,
          pauseReason: 'bad model',
        },
      }),
    )[0];
    expect(paused?.value).toBe('reviewer-agent · paused');
    expect(paused?.note).toContain('Paused by owner: bad model.');
    expect(
      reviewRows(settings({ agent: { ...settings().agent, tokenConfigured: false } }))[0]?.note,
    ).toContain('REVIEWER_AGENT_TOKEN');
  });

  it('only lets the optional trigger be edited', () => {
    expect(triggerItems(settings()).map((t) => [t.id, t.editable, t.note])).toEqual([
      ['wiki_meta', false, ' · built-in'],
      ['agent_edits_human_pages', true, ''],
      ['custom:lasers', false, ' · owner rule (path: safety/)'],
    ]);
  });

  it('sends only changed fields', () => {
    const s = settings();
    expect(reviewSettingsInput(reviewDraft(s), s)).toEqual({ ok: true, input: {} });
    expect(
      reviewSettingsInput(
        {
          reviewModel: 'human',
          spotCheckPercent: '25',
          reminderDays: '7',
          agentEditsHumanPages: false,
        },
        s,
      ),
    ).toEqual({
      ok: true,
      input: {
        reviewModel: 'human',
        spotCheckRate: 0.25,
        reminderDays: 7,
        agentEditsHumanPages: false,
      },
    });
  });

  it('validates percent 0..100 and days 1..30', () => {
    const s = settings();
    const bad = reviewSettingsInput(
      { ...reviewDraft(s), spotCheckPercent: '101', reminderDays: '0' },
      s,
    );
    expect(bad).toEqual({
      ok: false,
      fields: {
        spotCheckRate: 'A whole number from 0 to 100.',
        reminderDays: 'A whole number of days from 1 to 30.',
      },
    });
    expect(reviewSettingsInput({ ...reviewDraft(s), spotCheckPercent: '1.5' }, s).ok).toBe(false);
    expect(
      reviewSettingsInput({ ...reviewDraft(s), spotCheckPercent: '0', reminderDays: '30' }, s),
    ).toEqual({
      ok: true,
      input: { spotCheckRate: 0, reminderDays: 30 },
    });
  });
});
