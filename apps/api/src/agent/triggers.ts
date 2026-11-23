import { Inject, Injectable } from '@nestjs/common';
import {
  currentRun,
  evaluateTriggers,
  touchedSections,
  type FiredTrigger,
  type TriggerFacts,
} from '@md-wiki/domain';
import type { Prisma, Proposal } from '@prisma/client';
import { parseManifest } from '../contributions/views.js';
import { stateOf } from '../discussions/discussions.service.js';
import type { EscalationTriggers } from '../review/ports.js';
import { decodeMarkdown } from '../wiki/storage/wiki-storage.js';
import { settingsOf, triggerConfigOf } from './agent-facts.js';
import { pageAuthorsOf } from './page-authors.js';
import { CREDIBILITY_SIGNALS, type CredibilitySignals } from './ports.js';

type Tx = Prisma.TransactionClient;

/**
 * The mandatory escalation triggers (system-logic §7.8.3, D-203). `firing` runs inside the
 * decision transaction after the proposal row is locked, so it sees the facts at the moment the
 * approval would commit, not the ones the agent read: a trigger that starts firing after the
 * agent's read (a late blocking finding, an owners.md change, a new report) still refuses it.
 */
@Injectable()
export class MandatoryTriggers implements EscalationTriggers {
  constructor(@Inject(CREDIBILITY_SIGNALS) private readonly signals: CredibilitySignals) {}

  async facts(tx: Tx, proposal: Proposal): Promise<TriggerFacts> {
    const base = proposal.base ? decodeMarkdown(Buffer.from(proposal.base)) : null;
    const proposed = decodeMarkdown(Buffer.from(proposal.proposed));
    const [submitter, discussion, runs, authors] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: proposal.submitterId }, select: { kind: true } }),
      stateOf(tx, proposal.id),
      tx.aiJob.findMany({
        where: { proposalId: proposal.id, kind: 'quality_check' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          status: true,
          bundleHash: true,
          findings: { select: { severity: true, origin: true } },
        },
      }),
      pageAuthorsOf(tx, proposal.targetPath, proposal.submitterId),
    ]);
    const current = currentRun(runs, proposal.bundleHash);
    const credibility = await this.signals.facts(tx, {
      id: proposal.id,
      targetPath: proposal.targetPath,
      baseVersionLabel: parseManifest(proposal).context.target.version,
      touched: touchedSections(base, proposed),
    });
    return {
      targetPath: proposal.targetPath,
      submitterKind: submitter.kind,
      base,
      proposed,
      disputed: discussion.disputed,
      openReports: credibility.openReports,
      quality: {
        current: current !== null,
        blocking: current?.findings.filter((f) => f.severity === 'blocking').length ?? 0,
        ruleFindings: current?.findings.filter((f) => f.origin === 'rule').length ?? 0,
      },
      checkedAnchors: credibility.checkedAnchors,
      sourceProblems: credibility.sourceProblems,
      contradictions: credibility.contradictions,
      humanAuthors: authors.humanAuthors,
    };
  }

  async evaluate(tx: Tx, proposal: Proposal): Promise<FiredTrigger[]> {
    const settings = await settingsOf(tx);
    return evaluateTriggers(await this.facts(tx, proposal), triggerConfigOf(settings));
  }

  firing(tx: Tx, proposal: Proposal, actor: { id: string; kind: 'human' | 'agent' }) {
    if (actor.kind !== 'agent') return Promise.resolve([]);
    return this.evaluate(tx, proposal);
  }

  /** The stop switch (D-211): the paused reviewer agent records no decision or escalation. */
  async gate(tx: Tx, actor: { id: string }): Promise<string | null> {
    const s = await settingsOf(tx);
    return s.agentPaused && s.reviewerAgentId === actor.id ? 'The reviewer agent is paused' : null;
  }
}
