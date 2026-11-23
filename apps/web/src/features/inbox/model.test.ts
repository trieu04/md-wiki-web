import { describe, expect, it } from 'vitest';
import {
  agentNotes,
  inboxDetail,
  inboxRow,
  inboxTab,
  primaryOf,
  selectedItem,
  triggerText,
  type InboxItemDto,
} from './model';

const now = new Date('2026-11-24T12:00:00Z');
const item = (over: Partial<InboxItemDto> = {}): InboxItemDto => ({
  id: 'assignment:1',
  kind: 'rereview',
  tab: 'decide',
  done: false,
  title: 'Pinhole claim added to a sourced sentence',
  path: 'confocal.md',
  pageTitle: 'Confocal',
  anchor: 'principle',
  proposal: { slug: 'fix-pinhole', title: 'Fix pinhole units', state: 'pending' },
  topicId: null,
  spotCheckId: null,
  why: 'The reviewer agent may not approve this.',
  triggers: ['sourced_meaning'],
  agentNotes: '- Units match §2.4.\n\n* Only for 1.4 NA oil.',
  from: { id: 'a', name: 'reviewer-agent', kind: 'agent' },
  at: '2026-11-24T10:00:00Z',
  reminders: 0,
  action: 'decide',
  ...over,
});

describe('F-08 inbox model', () => {
  it('parses the tab and defaults to all', () => {
    expect(inboxTab('spot')).toBe('spot');
    expect(inboxTab('nope')).toBe('all');
    expect(inboxTab(undefined)).toBe('all');
  });

  it('shapes a row with type, age and where', () => {
    expect(inboxRow(item(), now)).toEqual({
      id: 'assignment:1',
      type: 'Re-review',
      dot: 'decide',
      age: '2 h',
      title: 'Pinhole claim added to a sourced sentence',
      where: 'confocal.md#principle · fix-pinhole',
    });
    expect(
      inboxRow(item({ anchor: null, proposal: null, tab: 'check', kind: 'check' }), now),
    ).toMatchObject({
      where: 'confocal.md',
      dot: 'check',
      type: 'Check',
    });
    expect(inboxRow(item({ done: true }), now).dot).toBe('done');
  });

  it('describes triggers in words; unknown ids pass through', () => {
    expect(triggerText('wiki_meta')).toBe('A change under wiki-meta/');
    expect(triggerText('custom:lasers')).toBe('Owner rule lasers');
    expect(triggerText('other')).toBe('other');
  });

  it('splits agent notes into bullets', () => {
    expect(agentNotes(item().agentNotes)).toEqual(['Units match §2.4.', 'Only for 1.4 NA oil.']);
    expect(agentNotes(null)).toEqual([]);
  });

  it('builds the detail panel with props, notes and the primary action', () => {
    const d = inboxDetail(item({ reminders: 2 }), now);
    expect(d.props).toEqual([
      { k: 'Proposal', v: 'fix-pinhole · Fix pinhole units' },
      { k: 'Page', v: 'Confocal' },
      { k: 'Trigger', v: 'A number, unit or negation changes in a sentence with a source' },
      { k: 'From', v: 'reviewer-agent (agent)' },
      { k: 'Waiting since', v: '2 h ago' },
      { k: 'Reminders', v: '2 sent' },
    ]);
    expect(d.ai).toHaveLength(2);
    expect(d.primary).toEqual({ label: 'Open review', href: '/work/proposals/fix-pinhole' });
  });

  it('routes each action', () => {
    expect(primaryOf(item({ action: 'discuss', topicId: 't1' })).href).toBe(
      '/work/discussions?topic=t1',
    );
    expect(primaryOf(item({ action: 'reply', topicId: 't1' })).label).toBe('Reply');
    expect(primaryOf(item({ action: 'open', tab: 'check' })).href).toBe('/work/credibility');
    expect(primaryOf(item({ action: 'open', tab: 'mentions', anchor: null })).href).toBe(
      '/wiki/confocal.md',
    );
  });

  it('only offers a spot-check decision while it is open', () => {
    expect(
      inboxDetail(item({ kind: 'spot_check', tab: 'spot', spotCheckId: 's1' }), now).spotCheckId,
    ).toBe('s1');
    expect(inboxDetail(item({ spotCheckId: 's1', done: true }), now).spotCheckId).toBeNull();
  });

  it('selects the requested item or the first', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(selectedItem('b', rows)?.id).toBe('b');
    expect(selectedItem('z', rows)?.id).toBe('a');
    expect(selectedItem(undefined, rows.slice(2))).toBeUndefined();
  });
});
