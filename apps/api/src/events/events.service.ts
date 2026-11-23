import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { PublicationPhase } from '@md-wiki/domain';
import { interval, map, merge, Observable, filter, Subject, type Subscription } from 'rxjs';

export const EVENT_TYPES = [
  'proposal.changed',
  'publication.changed',
  'page.changed',
  'discussion.changed',
  'quality.changed',
  'inbox.changed',
  'ping',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** The wire payload of one SSE message (system-logic §7.4.11). */
export interface WireEvent {
  type: EventType;
  slug?: string;
  path?: string;
  state?: string;
  phase?: PublicationPhase;
  topicId?: string;
  version?: number;
  draftId?: string;
  at: string;
}
interface Published extends WireEvent {
  /** Proposal events go to reviewers and the submitter only. */
  submitterId?: string;
  /** Further users who see a restricted event (participants of a proposal topic, §7.5.7). */
  audience?: readonly string[];
  /** Only `submitterId` (and `audience`) see it, not reviewers (a draft self-check). */
  private?: boolean;
}
export interface EventViewer {
  id: string;
  roles: readonly string[];
}
const REVIEW_ROLES = new Set(['reviewer', 'publisher', 'owner']);
export const PING_MS = 25_000;

/**
 * One bus per process: the public and the internal Nest apps each hold an EventsService, and a
 * job result stored by the internal listener reaches the public SSE streams (§7.6.7).
 */
const processBus = new Subject<Published>();

/** In-process fan-out of committed state changes (one API process per host, D-88). */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly subject = new Subject<Published>();
  private readonly bridge: Subscription = processBus.subscribe((event) => {
    this.subject.next(event);
  });

  /** Call after the transaction that made the change has committed. */
  emit(event: Omit<Published, 'at'>) {
    processBus.next({ ...event, at: new Date().toISOString() });
  }

  /** A quality run of a proposal (proposal audience) or a draft self-check (its author only). */
  quality(subject: { slug: string; submitterId: string } | { draftId: string; authorId: string }) {
    if ('slug' in subject)
      this.emit({ type: 'quality.changed', slug: subject.slug, submitterId: subject.submitterId });
    else
      this.emit({
        type: 'quality.changed',
        draftId: subject.draftId,
        submitterId: subject.authorId,
        private: true,
      });
  }

  proposal(slug: string, submitterId: string, state: string, phase?: PublicationPhase | null) {
    this.emit({
      type: 'proposal.changed',
      slug,
      submitterId,
      state,
      ...(phase && { phase }),
    });
  }

  publication(slug: string, submitterId: string, phase: PublicationPhase) {
    this.emit({ type: 'publication.changed', slug, submitterId, phase });
  }

  page(path: string) {
    this.emit({ type: 'page.changed', path });
  }

  /** A topic or dispute log changed (§7.5.7); restricted like the proposal when it holds one. */
  discussion(event: {
    topicId?: string;
    path: string;
    version: number;
    proposal?: { slug: string; submitterId: string; participants: readonly string[] };
  }) {
    this.emit({
      type: 'discussion.changed',
      path: event.path,
      version: event.version,
      ...(event.topicId && { topicId: event.topicId }),
      ...(event.proposal && {
        slug: event.proposal.slug,
        submitterId: event.proposal.submitterId,
        audience: event.proposal.participants,
      }),
    });
  }

  /** The viewers' inboxes changed (§7.8.8): only those users see it. */
  inbox(userIds: readonly string[]) {
    const [first, ...rest] = [...new Set(userIds)];
    if (first) this.emit({ type: 'inbox.changed', submitterId: first, audience: rest, private: true });
  }

  /** Committed changes for in-process consumers (the reviewer agent's scheduler, §7.8.6). */
  changes(): Observable<WireEvent> {
    return this.subject.asObservable();
  }

  visibleTo(event: Published, viewer: EventViewer): boolean {
    if (event.submitterId === undefined) return true;
    return (
      event.submitterId === viewer.id ||
      (event.audience?.includes(viewer.id) ?? false) ||
      (!event.private && viewer.roles.some((r) => REVIEW_ROLES.has(r)))
    );
  }

  /** The viewer's stream, with a keep-alive ping. */
  stream(viewer: EventViewer, pingMs = PING_MS): Observable<{ type: EventType; data: WireEvent }> {
    const events = this.subject.pipe(filter((event) => this.visibleTo(event, viewer)));
    const pings = interval(pingMs).pipe(
      map((): Published => ({ type: 'ping', at: new Date().toISOString() })),
    );
    return merge(events, pings).pipe(
      map(({ submitterId: _hidden, audience: _audience, private: _private, ...data }) => ({
        type: data.type,
        data,
      })),
    );
  }

  onModuleDestroy() {
    this.bridge.unsubscribe();
    this.subject.complete();
  }
}
