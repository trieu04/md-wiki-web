import type { components } from '@md-wiki/contracts';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from './query-keys';

export type EventDto = components['schemas']['EventDto'];
export const EVENT_TYPES = [
  'proposal.changed',
  'publication.changed',
  'page.changed',
  'discussion.changed',
  'quality.changed',
  'inbox.changed',
  'ping',
] as const satisfies readonly EventDto['type'][];

/**
 * Query-key prefixes an SSE event invalidates (system-logic §7.4.11, §7.5.7, §7.6.7, D-96). The contract names the
 * resources; these are the web's keys for them (`['page', path]` is `['wiki.page', { path }]`).
 */
export function invalidationsFor(event: Partial<EventDto> | null | undefined): QueryKey[] {
  switch (event?.type) {
    case 'proposal.changed':
      return [
        ['proposals'],
        ...(event.slug ? [queryKeys.proposal(event.slug), queryKeys.escalation(event.slug)] : []),
        queryKeys.suggestions,
        ['inbox'],
      ];
    case 'publication.changed':
      return [
        ...(event.slug ? [queryKeys.proposal(event.slug), queryKeys.escalation(event.slug)] : []),
        ['proposals'],
        queryKeys.opsBlocked,
        ['inbox'],
      ];
    case 'page.changed':
      return [
        ...(event.path ? [queryKeys.page(event.path), queryKeys.history(event.path)] : []),
        ['wiki.tree'],
        ['wiki.recent'],
        ['search'],
      ];
    case 'discussion.changed':
      return [
        ['topics'],
        ...(event.topicId ? [queryKeys.discussionTopic(event.topicId)] : []),
        ...(event.slug ? [queryKeys.proposalDiscussion(event.slug)] : []),
      ];
    case 'quality.changed':
      return [
        ...(event.slug
          ? [queryKeys.proposal(event.slug), ['proposals'], queryKeys.quality(event.slug)]
          : []),
        ...(event.draftId ? [queryKeys.selfCheck(event.draftId)] : []),
        ['ops', 'jobs'],
      ];
    case 'inbox.changed':
      return [['inbox'], ['escalation']];
    default:
      return [];
  }
}

export function parseEvent(data: unknown): Partial<EventDto> | null {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** Opens `/api/v1/events` while signed in and invalidates the affected queries (D-96). */
export function useServerEvents(enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/v1/events', { withCredentials: true });
    const onEvent = (message: MessageEvent) => {
      for (const queryKey of invalidationsFor(parseEvent(message.data)))
        void queryClient.invalidateQueries({ queryKey });
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent);
    return () => {
      source.close();
    };
  }, [enabled, queryClient]);
}
