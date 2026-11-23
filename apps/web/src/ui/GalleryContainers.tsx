import { useRef, useState } from 'react';
import { Button } from './Button';
import { Callout } from './Callout';
import { Card } from './Card';
import { Drawer } from './Drawer';
import { GalleryExample as Example } from './GalleryExample';
import { DecisionOptions, DecisionReason, SourceRadios, SourceResults } from './GalleryForms';
import { PillToggle } from './PillToggle';
import { Table } from './Table';
import { DiffView } from './DiffView';
import { MarkdownToolbar } from './MarkdownToolbar';
import { Tabs } from './Tabs';
import type { Tab } from './Tabs';
import { Textarea } from './Textarea';
import { TrustBadge } from './TrustBadge';
import { TrustIcon } from './TrustIcon';

const recent = [
  ['Point spread function', 'NA table', 'Corrected the 1.4 NA oil value', 'reviewed', '3 h ago'],
  [
    'Confocal microscopy',
    'Detectors',
    'Hybrid detectors named HyD; link to Detectors page',
    'reviewed',
    '5 h ago',
  ],
  ['Pinhole alignment', 'Steps', 'Step 4 checked against the service manual', 'checked', '2 d ago'],
] as const;
const topics = [
  ['Microscopy techniques', 24],
  ['Image processing', 31],
  ['Sample preparation', 18],
  ['Instruments and booking', 22],
  ['Protocols', 33],
] as const;

function RecentCard() {
  const [scope, setScope] = useState('mine');
  return (
    <Card
      title="Recently updated"
      header
      actions={
        <div className="flex gap-4px" role="group" aria-label="Page scope">
          <PillToggle
            size="scope"
            pressed={scope === 'mine'}
            onClick={() => {
              setScope('mine');
            }}
          >
            Pages you use
          </PillToggle>
          <PillToggle
            size="scope"
            pressed={scope === 'all'}
            onClick={() => {
              setScope('all');
            }}
          >
            All pages
          </PillToggle>
        </div>
      }
    >
      <div data-gallery="Table/scroll">
        <Table label="Recently updated pages">
          <thead>
            <tr>
              {['Page', 'What changed', 'Trust now', 'When'].map((title, index) => (
                <th
                  key={title}
                  scope="col"
                  className={`py-10px ${index === 0 || index === 3 ? 'px-18px' : 'px-12px'}`}
                >
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(scope === 'mine'
              ? recent
              : [
                  ...recent.slice(0, 2),
                  [
                    'Light-sheet microscopy',
                    'Overview',
                    'Lead reworded',
                    'reviewed',
                    '5 h ago',
                  ] as const,
                  ...recent.slice(2),
                ]
            ).map(([page, section, change, label, when]) => (
              <tr key={page}>
                <td className="px-18px py-12px">
                  <a href="#gallery-containers" className="font-semibold no-underline">
                    {page}
                  </a>
                  <div className="text-12 text-muted">{section}</div>
                </td>
                <td className="p-12px text-secondary">{change}</td>
                <td className="p-12px whitespace-nowrap">
                  <TrustBadge variant="inline" label={label} />
                </td>
                <td className="px-18px py-12px whitespace-nowrap text-muted">{when}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}

const proposalTabs = [
  ['open', 'Open', 4],
  ['stale', 'Stale', 1],
  ['blocked', 'Blocked', 1],
  ['published', 'Published', 51],
  ['rejected', 'Rejected', 7],
  ['all', 'All', 64],
] as const;
const activityTabs = [
  ['following', 'Followed pages', 6],
  ['trust', 'Your checks and reports', 14],
  ['suggestions', 'Your suggestions', 3],
] as const;

function CountedTabs({ activity = false }: { activity?: boolean }) {
  const [selected, setSelected] = useState(activity ? 'following' : 'open');
  const tabs = (activity ? activityTabs : proposalTabs).map(([id, label, count]): Tab => ({
    id,
    label,
    count,
    panel: (
      <p className="p-12px text-13 text-muted">
        {label}: {count}
      </p>
    ),
  }));
  return (
    <Tabs
      label={activity ? 'Your activity' : 'State'}
      variant={activity ? 'activity' : 'workspace'}
      tabs={tabs}
      selected={selected}
      onChange={setSelected}
    />
  );
}

const evidence = [
  [
    '12 Nov',
    'Checked against Pawley Table 2.1 by a person',
    'Supports the text · numbers compared · archived copy',
  ],
  ['12 Nov', 'Change update-confocal-psf-2 published', 'Approved by m.nguyen (page author)'],
  [
    '12 Nov',
    'Agrees with Point spread function › FWHM',
    'Independent source · link confirmed by a reviewer',
  ],
  ['4 Sep', 'First reviewed', 'Approved by h.pham'],
];

function WhyTrust() {
  return (
    <>
      <p className="text-secondary">
        A person compared this exact version with its source and recorded that it matches. That is
        the highest label a section can have.
      </p>
      <div className="flex flex-col gap-8px">
        <h3 className="font-bold">Evidence, newest first</h3>
        <ol className="flex list-none flex-col">
          {evidence.map(([when, what, meta]) => (
            <li key={what} className="flex gap-12px border-t border-row py-9px">
              <span className="w-trust-date shrink-0 pt-mark-x text-12 text-muted">{when}</span>
              <span className="flex flex-col">
                {what}
                <span className="text-12 text-muted">{meta}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col gap-6px">
        <h3 className="font-bold">What would change it</h3>
        <ul className="flex list-disc flex-col gap-3px pl-18px text-secondary">
          <li>An edit to this section: back to Not reviewed until it is reviewed.</li>
          <li>A confirmed report, or a source being retracted: Under re-check.</li>
          <li>A confirmed mistake: Confirmed error until fixed.</li>
        </ul>
      </div>
      <p className="rounded-8 bg-canvas px-12px py-10px text-12 text-muted">
        Labels follow fixed rules over these records; they are not a score. A check by an agent
        alone never makes a section Checked against source.
      </p>
    </>
  );
}

function DrawerExample() {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState('why');
  const trigger = useRef<HTMLButtonElement>(null);
  const tabs: Tab[] = [
    { id: 'why', label: 'Why this label', panel: <WhyTrust /> },
    {
      id: 'check',
      label: 'I checked a source',
      panel: (
        <>
          <SourceRadios />
          <SourceResults />
        </>
      ),
    },
    { id: 'use', label: 'I used it', panel: <Textarea label="What did you have to change?" /> },
    {
      id: 'report',
      label: 'Report a problem',
      panel: <Textarea rows={3} label="What should it say, and how do you know?" />,
    },
  ].map((tab) => ({
    ...tab,
    panel: <div className="flex flex-col gap-16px px-22px pt-18px pb-28px">{tab.panel}</div>,
  }));
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="self-start text-accent underline"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open trust drawer
      </button>
      <Example id="Drawer/open">
        <div className="flex min-h-trust-layout flex-col">
          <div className="flex grow flex-wrap items-stretch">
            <div
              className="flex min-w-0 flex-trust-context justify-center bg-muted-drawer px-40px py-32px"
              aria-hidden="true"
            >
              <div className="flex w-full max-w-trust-preview flex-col gap-14px self-start rounded-12 bg-surface px-36px py-28px">
                <span className="font-content text-30 font-semibold">Confocal microscopy</span>
                <span className="font-content text-22 font-semibold">Resolution</span>
                <span className="font-content text-17 leading-prose">
                  Lateral resolution is about 0.51 λ / NA with a pinhole of one Airy unit. Axial
                  resolution is two to three times worse.
                </span>
                <span className="font-content text-22 font-semibold">Detectors</span>
                <span className="font-content text-17 leading-prose">
                  Photomultiplier tubes remain common. Hybrid detectors offer higher quantum
                  efficiency and lower noise.
                </span>
              </div>
            </div>
            <Drawer
              open={open}
              onClose={() => {
                setOpen(false);
              }}
              triggerRef={trigger}
              title="Resolution"
              context="Confocal microscopy ›"
              summary={
                <p className="inline-flex items-center gap-8px font-semibold">
                  <TrustIcon label="checked" />
                  Checked against source{' '}
                  <span className="font-normal text-muted">· version 20261123-2</span>
                </p>
              }
            >
              <div data-gallery="Tabs/drawer">
                <Tabs
                  label="Trust actions"
                  variant="drawer"
                  tabs={tabs}
                  selected={selected}
                  onChange={setSelected}
                />
              </div>
            </Drawer>
          </div>
        </div>
      </Example>
    </>
  );
}

export function ContainerExamples() {
  return (
    <section aria-labelledby="gallery-containers" className="flex min-w-0 flex-col gap-12px">
      <h2 id="gallery-containers" className="text-20 font-semibold">
        Containers
      </h2>
      <Example id="Card/default" canvas>
        <Card title="Browse by topic">
          <div className="mt-4px flex flex-col gap-6px">
            {topics.map(([topic, count]) => (
              <a
                key={topic}
                href="#gallery-containers"
                className="flex justify-between border-t border-row py-7px text-primary no-underline"
              >
                <span>{topic}</span>
                <span className="text-muted">{count}</span>
              </a>
            ))}
          </div>
        </Card>
      </Example>
      <Example id="Card/header" canvas>
        <RecentCard />
      </Example>
      <Example id="Tabs/workspace">
        <CountedTabs />
      </Example>
      <Example id="Tabs/activity">
        <CountedTabs activity />
      </Example>
      <Example id="MarkdownToolbar/default">
        <MarkdownToolbar onFormat={() => undefined} />
      </Example>
      <Example id="DiffView/changes">
        <DiffView
          rows={[
            {
              kind: 'del',
              number: 14,
              text: 'Closing the pinhole improves sectioning and reduces the detected signal.',
            },
            {
              kind: 'add',
              number: 14,
              text: 'Closing the pinhole below about 1 Airy unit (AU) gives little extra sectioning and reduces the detected signal.[^4]',
            },
            { kind: 'add', number: 18, text: '[^4]: sources/pawley-handbook.md, §2.4' },
          ]}
        />
      </Example>
      <Example id="Callout/warn">
        <Callout tone="warn" title="Use with care: this section is being re-checked.">
          <span>
            A reader reported the pinhole wording is outdated; m.nguyen confirmed it on 22 Nov. A
            fix is being reviewed.{' '}
            <a href="#gallery-containers" className="font-semibold text-trust-recheck-fg">
              See the proposed fix
            </a>
          </span>
        </Callout>
      </Example>
      <Example id="Callout/error" canvas>
        <Callout
          tone="error"
          title="Publish outcome unknown."
          action={
            <a href="#gallery-containers" className="font-semibold">
              Investigate in Operations
            </a>
          }
        >
          The write timed out. Nobody can publish to this page until the owner confirms what was
          written.
        </Callout>
      </Example>
      <Example id="Callout/success">
        <Callout tone="success" title="Source check saved">
          It counts for this version of Resolution.
        </Callout>
      </Example>
      <Example id="Callout/info" canvas>
        <Callout tone="info" title="Your decision" label="Decision">
          <div className="flex flex-col gap-10px">
            <DecisionOptions />
            <DecisionReason />
            <Button>Approve and publish</Button>
          </div>
          <span className="font-mono text-11 text-muted">
            Bound to bundle a1f3c9e2 · artifact 9c0e57b1 · preview 10:31 · discussion v1 · dispute
            v0
          </span>
        </Callout>
      </Example>
      <Example id="Callout/ai" canvas>
        <Callout tone="ai" title="Agent review">
          <ul className="flex list-disc flex-col gap-3px pl-18px text-13 text-secondary">
            <li>Checked: “1 Airy unit (AU)” matches §2.4.</li>
            <li>
              Not shown in the source: “little extra sectioning” in general. §2.4 covers 1.4 NA oil
              only.
            </li>
            <li>Approval refused by the API because of the trigger; escalated.</li>
          </ul>
          <span className="text-12 text-trust-none">
            reviewer-agent · claude-opus-5-5 · prompt v3 · 10:09
          </span>
        </Callout>
      </Example>
      <DrawerExample />
    </section>
  );
}

export function UndrawnContainerExamples() {
  return (
    <>
      <Example id="Card/loading">
        <Card title="Recently updated (loading)" state={{ type: 'loading' }} />
      </Example>
      <Example id="Card/empty">
        <Card
          title="Recently updated (empty)"
          header
          state={{ type: 'empty', message: 'Follow pages you rely on to hear when they change.' }}
        />
      </Example>
      <Example id="Callout/query-error">
        <Callout
          tone="error"
          queryError
          title="Could not load pages."
          action={<Button variant="secondary">Try again</Button>}
        >
          Try again to reload the list.
        </Callout>
      </Example>
    </>
  );
}
