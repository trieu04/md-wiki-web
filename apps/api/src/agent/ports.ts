import type { Prisma } from '@prisma/client';
import { logger } from '../common/request-id.middleware.js';

/**
 * Ports Phase 9 (credibility, notifications) plugs into (system-logic §7.8.10). Phase 8 ships
 * log / no-op implementations so self-managed review works on its own.
 */

// ---- notifications to page authors ---------------------------------------------------------

export interface EscalationNotice {
  escalationId: string;
  kind: 'rereview' | 'discussion';
  proposal: { id: string; slug: string; title: string; targetPath: string };
  triggers: readonly string[];
  notes: string;
  recipients: readonly string[];
  reminder: number;
}
export interface PublishedDigestItem {
  proposal: { id: string; slug: string; title: string; targetPath: string };
  versionLabel: string;
  reviewerKind: 'agent' | 'person';
  auto: boolean;
  publishedAt: Date;
  recipients: readonly string[];
}
export interface SpotCheckNotice {
  spotCheckId: string;
  proposal: { id: string; slug: string; title: string; targetPath: string };
  recipients: readonly string[];
}
/** "Notify page authors" (D-212, D-213). Calls happen after the commit; failures are logged. */
export interface AuthorNotifier {
  escalated(notice: EscalationNotice): Promise<void>;
  reminded(notice: EscalationNotice): Promise<void>;
  /** One item per auto-published change to the recipients' pages (Phase 9 batches digests). */
  published(item: PublishedDigestItem): Promise<void>;
  spotCheckRequested(notice: SpotCheckNotice): Promise<void>;
}
export const AUTHOR_NOTIFIER = Symbol('AUTHOR_NOTIFIER');
export class LogAuthorNotifier implements AuthorNotifier {
  escalated(n: EscalationNotice) {
    logger.info({ escalationId: n.escalationId, recipients: n.recipients.length }, 'escalated');
    return Promise.resolve();
  }
  reminded(n: EscalationNotice) {
    logger.info({ escalationId: n.escalationId, reminder: n.reminder }, 'escalation reminder');
    return Promise.resolve();
  }
  published(item: PublishedDigestItem) {
    logger.info({ slug: item.proposal.slug, recipients: item.recipients.length }, 'digest item');
    return Promise.resolve();
  }
  spotCheckRequested(n: SpotCheckNotice) {
    logger.info({ spotCheckId: n.spotCheckId }, 'spot check requested');
    return Promise.resolve();
  }
}

// ---- confirmed errors (failed spot checks) ---------------------------------------------------

export interface ConfirmedError {
  source: 'spot_check';
  spotCheckId: string;
  proposalId: string;
  path: string;
  versionLabel: string;
  sections: readonly { anchor: string; sectionHash: string }[];
  actorId: string;
  reason: string;
  at: Date;
}
/**
 * A failed spot check is a confirmed error (D-214). Runs inside the transaction that records
 * the outcome; the Phase 9 label engine turns it into a label record. Phase 8: nothing beyond
 * the SpotCheck row and its audit event.
 */
export interface ConfirmedErrors {
  record(tx: Prisma.TransactionClient, error: ConfirmedError): Promise<void>;
}
export const CONFIRMED_ERRORS = Symbol('CONFIRMED_ERRORS');
export class RecordOnlyConfirmedErrors implements ConfirmedErrors {
  record() {
    return Promise.resolve();
  }
}

// ---- credibility inputs of the mandatory triggers -------------------------------------------

export interface CredibilityFacts {
  openReports: number;
  checkedAnchors: string[];
  sourceProblems: { retracted: string[]; lowTierAdded: string[] };
  contradictions: number;
}
/** Read inside the decision transaction (D-203). Phase 8: no credibility records exist. */
export interface CredibilitySignals {
  facts(
    tx: Prisma.TransactionClient,
    proposal: { id: string; targetPath: string; baseVersionLabel: string | null; touched: string[] },
  ): Promise<CredibilityFacts>;
}
export const CREDIBILITY_SIGNALS = Symbol('CREDIBILITY_SIGNALS');
export class NoCredibilitySignals implements CredibilitySignals {
  facts() {
    return Promise.resolve({
      openReports: 0,
      checkedAnchors: [],
      sourceProblems: { retracted: [], lowTierAdded: [] },
      contradictions: 0,
    });
  }
}

// ---- inbox "Check" items (re-checks, reports) -----------------------------------------------

export interface CheckItem {
  id: string;
  title: string;
  path: string;
  anchor: string | null;
  why: string;
  at: Date;
  done: boolean;
}
export interface InboxCheckItems {
  forUser(userId: string): Promise<CheckItem[]>;
}
export const INBOX_CHECK_ITEMS = Symbol('INBOX_CHECK_ITEMS');
export class NoCheckItems implements InboxCheckItems {
  forUser() {
    return Promise.resolve([]);
  }
}
