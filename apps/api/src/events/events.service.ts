import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { PublicationPhase } from '@md-wiki/domain';
import { interval, map, merge, Observable, filter, Subject } from 'rxjs';

export const EVENT_TYPES = [
  'proposal.changed',
  'publication.changed',
  'page.changed',
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
  at: string;
}
interface Published extends WireEvent {
  /** Proposal events go to reviewers and the submitter only. */
  submitterId?: string;
}
export interface EventViewer {
  id: string;
  roles: readonly string[];
}
const REVIEW_ROLES = new Set(['reviewer', 'publisher', 'owner']);
export const PING_MS = 25_000;

/** In-process fan-out of committed state changes (one API process per host, D-88). */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly subject = new Subject<Published>();

  /** Call after the transaction that made the change has committed. */
  emit(event: Omit<Published, 'at'>) {
    this.subject.next({ ...event, at: new Date().toISOString() });
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

  visibleTo(event: Published, viewer: EventViewer): boolean {
    if (event.submitterId === undefined) return true;
    return event.submitterId === viewer.id || viewer.roles.some((r) => REVIEW_ROLES.has(r));
  }

  /** The viewer's stream, with a keep-alive ping. */
  stream(viewer: EventViewer, pingMs = PING_MS): Observable<{ type: EventType; data: WireEvent }> {
    const events = this.subject.pipe(filter((event) => this.visibleTo(event, viewer)));
    const pings = interval(pingMs).pipe(
      map((): Published => ({ type: 'ping', at: new Date().toISOString() })),
    );
    return merge(events, pings).pipe(
      map(({ submitterId: _hidden, ...data }) => ({ type: data.type, data })),
    );
  }

  onModuleDestroy() {
    this.subject.complete();
  }
}
