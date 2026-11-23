import { describe, expect, it } from 'vitest';
import { visualProposalDiscussion, visualTopics } from '../src/dev/fixtures/discussions';
import { visualProposal } from '../src/dev/fixtures/review';
import {
  BODY_MAX,
  TITLE_MAX,
  askErrors,
  askHref,
  askInput,
  discussionsHref,
  pageOptions,
  readOnlyNote,
  searchAskHref,
  sectionHref,
  sectionOptions,
  selectedTopicId,
  threadActions,
  threadPosts,
  threadProps,
  threadTextError,
  topicFilter,
  topicFilters,
  topicRow,
  topicStatus,
  type TopicDetailDto,
} from '../src/features/discussions/model';
import {
  decisionChoices,
  discussionCount,
  disputeRows,
  holdAction,
  proposalStatus,
  detailStatusInput,
  reviewBanner,
  submitState,
  versionsChanged,
  seenVersions,
  type ProposalDetailDto,
} from '../src/features/review/model';
import { workNavCounts } from '../src/features/workspace/model';
import { invalidationsFor } from '../src/lib/events';

const [holding, report, closed] = visualTopics as [TopicDetailDto, TopicDetailDto, TopicDetailDto];
const now = new Date('2026-11-23T12:00:00Z');
function need<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('fixture value missing');
  return value;
}

describe('F-11 list model', () => {
  it('reads ?filter= and labels the pills with counts except All', () => {
    expect(topicFilter('closed')).toBe('closed');
    expect(topicFilter('bogus')).toBe('open');
    expect(topicFilter(undefined)).toBe('open');
    expect(topicFilters({ open: 3, mine: 2, closed: 41, all: 44 }).map((f) => f.label)).toEqual([
      'Open 3',
      'Mine 2',
      'Closed 41',
      'All',
    ]);
    expect(topicFilters(undefined).map((f) => f.label)).toEqual(['Open', 'Mine', 'Closed', 'All']);
  });

  it('builds hrefs for Discussions, the compose form and the section', () => {
    expect(discussionsHref({})).toBe('/work/discussions');
    expect(discussionsHref({ filter: 'mine', topic: 'a b' })).toBe(
      '/work/discussions?filter=mine&topic=a+b',
    );
    expect(askHref({})).toBe('/ask');
    expect(askHref({ path: 'a/b c.md', section: 'x', q: '  ' })).toBe(
      '/ask?path=a%2Fb+c.md&section=x',
    );
    expect(searchAskHref('pinhole', [{ path: 'p.md', anchor: 'principle' }])).toBe(
      '/ask?path=p.md&section=principle&q=pinhole',
    );
    // No hits: the form asks for a page.
    expect(searchAskHref('nothing', [])).toBe('/ask?q=nothing');
    expect(sectionHref({ path: 'dir/ü.md', anchor: 'a b' })).toBe('/wiki/dir/%C3%BC.md#a%20b');
    expect(sectionHref({ path: 'p.md', anchor: null })).toBe('/wiki/p.md');
  });

  it('says when a topic holds a proposal, else its status, with replies and age', () => {
    expect(topicRow(holding, now)).toMatchObject({
      where: 'point-spread-function.md#fwhm',
      tone: 'escalated',
      status: 'Holds psf-fwhm-table',
      meta: '3 replies · 3 h',
    });
    expect(topicRow({ ...report, replies: 1 }, now)).toMatchObject({
      tone: 'pending',
      status: 'Open',
      meta: '1 reply · 1 d',
    });
    expect(topicStatus({ status: 'on_hold', proposal: null })).toEqual({
      tone: 'pending',
      text: 'On hold',
    });
    expect(topicStatus({ status: 'rejected', proposal: null }).tone).toBe('closed');
    // A decided proposal no longer holds: the topic shows its own status.
    expect(
      topicStatus({ status: 'open', proposal: { ...need(holding.proposal), holds: false } }).text,
    ).toBe('Open');
    expect(topicRow({ ...report, anchor: null }, now).where).toBe('confocal-microscopy.md');
  });

  it('selects ?topic= else the first listed topic', () => {
    expect(selectedTopicId('x', [{ id: 'a' }])).toBe('x');
    expect(selectedTopicId(undefined, [{ id: 'a' }, { id: 'b' }])).toBe('a');
    expect(selectedTopicId(undefined, [])).toBeNull();
  });
});

describe('F-11 thread model', () => {
  it('lists properties: opener, other participants, proposal, closing, version', () => {
    expect(threadProps(holding)).toEqual([
      { k: 'Opened by', v: 'reviewer-agent' },
      { k: 'Participants', v: 'm.nguyen, h.pham' },
      { k: 'Proposal', v: 'psf-fwhm-table · held by this topic' },
      { k: 'Version', v: 'discussion v2' },
    ]);
    expect(threadProps(closed)).toEqual([
      { k: 'Opened by', v: 'a.tran' },
      { k: 'Participants', v: 'h.pham' },
      { k: 'Closed by', v: 'h.pham · Resolved' },
      { k: 'Rationale', v: 'Use the 2019 review article instead.' },
      { k: 'Version', v: 'discussion v6' },
    ]);
    // Only the author takes part: no Participants row.
    expect(threadProps(report).map(({ k }) => k)).toEqual(['Opened by', 'Version']);
  });

  it('describes each entry kind and marks agents', () => {
    const base = need(holding.entries[1]);
    const posts = threadPosts(
      [
        need(holding.entries[0]),
        base,
        { ...base, id: 'r', parentSeq: 2 },
        { ...base, id: 'a', kind: 'agreement', parentSeq: null, agreesWith: 2 },
        { ...base, id: 'c', kind: 'close', parentSeq: null, outcome: 'on_hold' },
        { ...base, id: 'o', kind: 'reopen', parentSeq: null },
      ],
      now,
    );
    expect(posts.map(({ action }) => action)).toEqual([
      'opened the topic',
      'reply',
      'reply to #2',
      'agrees with #2',
      'closed as On hold',
      'reopened',
    ]);
    expect(posts[0]).toMatchObject({ initials: 'RA', agent: true, time: '22 h' });
    expect(posts[1]).toMatchObject({ initials: 'HP', agent: false, who: 'h.pham' });
  });

  it('offers controls only from `can`, and never on_hold → on_hold', () => {
    expect(threadActions(holding)).toMatchObject({
      reply: true,
      reopen: false,
      any: true,
      close: [
        { value: 'resolved', label: 'Resolved' },
        { value: 'rejected', label: 'Rejected' },
        { value: 'on_hold', label: 'On hold' },
      ],
    });
    expect(threadActions({ ...holding, status: 'on_hold' }).close.map((c) => c.value)).toEqual([
      'resolved',
      'rejected',
    ]);
    expect(threadActions(closed)).toMatchObject({ reply: false, close: [], reopen: true });
    expect(
      threadActions({ ...report, can: { comment: false, close: false, reopen: false } }).any,
    ).toBe(false);
    expect(threadActions(holding).placeholder).toMatch(/locks open review decisions/u);
    expect(threadActions(report).placeholder).toBe('Write a reply.');
  });

  it('explains read-only threads', () => {
    expect(
      readOnlyNote({ ...holding, proposal: { ...need(holding.proposal), state: 'published' } }),
    ).toBe('The proposal was decided. This thread is kept as history.');
    expect(readOnlyNote(closed)).toBe('This topic is closed.');
    expect(readOnlyNote(report)).toBe('You can read this topic but not reply to it.');
  });

  it('requires a reply or a rationale (whitespace is empty)', () => {
    expect(threadTextError({ kind: 'reply' }, '  ')).toBe('Write a reply first.');
    expect(threadTextError({ kind: 'close', outcome: 'resolved' }, '')).toMatch(/rationale/u);
    expect(threadTextError({ kind: 'reopen' }, '\n')).toMatch(/reopen/u);
    expect(threadTextError({ kind: 'reply' }, 'ok')).toBeNull();
  });
});

describe('Ask a question model', () => {
  const draft = { path: 'p.md', section: 'principle', title: ' Why? ', body: ' Because. ' };

  it('validates page, title 1..120 and body 1..20000 after trimming', () => {
    expect(askErrors(draft)).toEqual({});
    expect(askErrors({ path: '', section: '', title: '  ', body: '' })).toEqual({
      path: 'Choose the page your question is about.',
      title: 'Give your question a short title.',
      body: 'Write your question.',
    });
    expect(askErrors({ ...draft, title: 'x'.repeat(TITLE_MAX) })).toEqual({});
    expect(askErrors({ ...draft, title: 'x'.repeat(TITLE_MAX + 1) }).title).toBe(
      'Keep the title under 121 characters.',
    );
    expect(askErrors({ ...draft, body: 'x'.repeat(BODY_MAX + 1) }).body).toBe(
      'This question is too long.',
    );
  });

  it('sends trimmed text and a null anchor for the whole page', () => {
    expect(askInput(draft)).toEqual({
      path: 'p.md',
      anchor: 'principle',
      title: 'Why?',
      body: 'Because.',
    });
    expect(askInput({ ...draft, section: '' }).anchor).toBeNull();
  });

  it('offers the whole page then sections, and keeps an unknown preselected page', () => {
    expect(sectionOptions([{ anchor: 'a', title: 'A' }])).toEqual([
      { value: '', label: 'Whole page' },
      { value: 'a', label: 'A' },
    ]);
    expect(sectionOptions(undefined)).toEqual([{ value: '', label: 'Whole page' }]);
    const tree = {
      topics: [
        {
          id: 't',
          name: 'Topic',
          pageCount: 1,
          pages: [
            {
              path: 'p.md',
              title: 'P',
              updatedAt: '',
              pageLabel: {
                label: 'reviewed' as const,
                spread: { checked: 0, reviewed: 1, not_reviewed: 0, recheck: 0, error: 0 },
              },
            },
          ],
        },
      ],
    };
    expect(pageOptions(tree, 'p.md')).toEqual({
      groups: [{ id: 't', name: 'Topic', pages: [{ value: 'p.md', label: 'P (p.md)' }] }],
      extra: null,
    });
    expect(pageOptions(tree, 'gone.md').extra).toBe('gone.md');
    expect(pageOptions(undefined, null)).toEqual({ groups: [], extra: null });
  });
});

describe('F-10 discussion model (P6-06)', () => {
  const pending = visualProposal('fix-pinhole-units', null);
  const disputed = visualProposal('fix-pinhole-units', 'disputed');
  const disputedLog = visualProposalDiscussion('fix-pinhole-units', 'disputed');

  it('shows Disputed while a hold or dispute blocks approval (pending only)', () => {
    expect(proposalStatus(detailStatusInput(disputed))).toEqual({
      tone: 'escalated',
      status: 'Disputed',
      detail: 'Approval held for discussion',
    });
    expect(proposalStatus(detailStatusInput(pending)).status).toBe('Pending');
  });

  it('chooses the dispute action from the log: open, reopen, comment', () => {
    const d = pending.discussion;
    expect(holdAction(d)).toBe('open');
    expect(holdAction({ ...d, disputeVersion: 2, disputeOpen: false })).toBe('reopen');
    expect(holdAction({ ...d, disputeVersion: 1, disputeOpen: true })).toBe('comment');
    expect(decisionChoices(disputed).map(({ submit }) => submit)).toEqual([
      'Approve and publish',
      'Send back with reason',
      'Add to dispute',
    ]);
  });

  it('holds approval while disputed, keeps Request changes; a lock wins', () => {
    expect(submitState('approve', disputed, null)).toEqual({
      label: 'Approval held by dispute',
      disabled: true,
    });
    expect(submitState('changes', disputed, null)).toEqual({
      label: 'Send back with reason',
      disabled: false,
    });
    expect(submitState('hold', pending, null)).toEqual({ label: 'Open dispute', disabled: false });
    expect(submitState('changes', pending, 'DISCUSSION_CHANGED')).toEqual({
      label: 'Reread before deciding',
      disabled: true,
    });
    expect(submitState('approve', { ...pending, preview: null }, null).disabled).toBe(true);
  });

  it('banners the dispute (with who and why) or the unresolved topic', () => {
    expect(reviewBanner(disputed, null, '/wiki/p.md', disputedLog)).toEqual({
      tone: 'warn',
      title: 'Held by a dispute.',
      text: 'h.pham disputed it: “Does the claim hold for other objectives? §2.4 covers 1.4 NA oil only.” You can still ask for changes.',
      action: { label: 'Go to dispute', tab: 'discussion' },
    });
    expect(reviewBanner(disputed, null, '/wiki/p.md')?.text).toBe('You can still ask for changes.');
    const held: ProposalDetailDto = {
      ...pending,
      discussion: { ...pending.discussion, held: true, disputed: true },
    };
    expect(
      reviewBanner(held, null, '/wiki/p.md', visualProposalDiscussion('fix-pinhole-units', null)),
    ).toMatchObject({
      title: 'Held by a discussion.',
      text: '“Is the claim general?” is not resolved yet. You can still ask for changes.',
      action: { label: 'Go to discussion', tab: 'discussion' },
    });
    // A lock outranks the hold; a decided proposal shows no hold.
    expect(reviewBanner(disputed, 'DISCUSSION_CHANGED', '/', disputedLog)?.title).toBe(
      'New discussion entry.',
    );
    expect(reviewBanner({ ...held, state: 'rejected' }, null, '/')).toBeNull();
  });

  it('locks the decision when versions move under the reviewer, only while deciding', () => {
    const seen = seenVersions(pending);
    expect(versionsChanged(seen, pending)).toBe(false);
    const newer = {
      ...pending,
      discussion: { ...pending.discussion, discussionVersion: 2 },
    };
    expect(versionsChanged(seen, newer)).toBe(true);
    expect(
      versionsChanged(seen, {
        ...pending,
        discussion: { ...pending.discussion, disputeVersion: 1 },
      }),
    ).toBe(true);
    expect(versionsChanged(seen, { ...newer, can: { ...newer.can, decide: false } })).toBe(false);
    expect(versionsChanged(seen, { ...newer, state: 'approved' })).toBe(false);
  });

  it('counts the topic and the dispute log, and renders dispute rows', () => {
    expect(discussionCount(undefined)).toBeUndefined();
    expect(discussionCount(disputedLog)).toBe(2);
    expect(discussionCount({ ...disputedLog, topic: null })).toBe(1);
    const event = need(disputedLog.disputes.events[0]);
    expect(
      disputeRows([
        event,
        {
          ...event,
          seq: 2,
          action: 'resolve',
          resolutionKind: 'scoped',
          reason: 'Oil only.',
          relatedSlugs: ['a', 'b'],
        },
      ]).map(({ text }) => text),
    ).toEqual([
      'opened the dispute: Does the claim hold for other objectives? §2.4 covers 1.4 NA oil only.',
      'resolved the dispute (scoped to where it holds): Oil only. Related: a, b.',
    ]);
  });
});

describe('WorkNav and SSE (P6)', () => {
  it('adds the open topic count to the WorkNav', () => {
    const topics = { open: 3, mine: 2, closed: 41, all: 44 };
    expect(workNavCounts(undefined, ['reader'], topics)).toEqual({ discussions: 3 });
    expect(workNavCounts(undefined, ['reader'], undefined)).toBeUndefined();
  });

  it('discussion.changed invalidates topics, the topic and the proposal discussion', () => {
    expect(
      invalidationsFor({ type: 'discussion.changed', topicId: 't', slug: 's', path: 'p.md' }),
    ).toEqual([['topics'], ['topic', 't'], ['proposal-discussion', 's']]);
    // Dispute-log entries carry no topicId.
    expect(invalidationsFor({ type: 'discussion.changed', path: 'p.md', slug: 's' })).toEqual([
      ['topics'],
      ['proposal-discussion', 's'],
    ]);
    expect(invalidationsFor({ type: 'discussion.changed', topicId: 't' })).toEqual([
      ['topics'],
      ['topic', 't'],
    ]);
  });
});
