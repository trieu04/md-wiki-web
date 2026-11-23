import { useState } from 'react';
import type { ReactNode } from 'react';
import { labelMeta } from '@md-wiki/domain';
import type { Label } from '@md-wiki/domain';
import { AITag } from './AITag';
import { Button } from './Button';
import { Chip } from './Chip';
import { CountBadge } from './CountBadge';
import { Mark } from './Mark';
import { Mono } from './Mono';
import { PillToggle } from './PillToggle';
import { SpreadBar } from './SpreadBar';
import { TrustBadge } from './TrustBadge';
import { TrustIcon } from './TrustIcon';
import { themeTokens } from './theme-tokens';

type ExampleProps = { id: string; children: ReactNode; canvas?: boolean };
function Example({ id, children, canvas }: ExampleProps) {
  return (
    <div>
      <div className="text-12 text-muted">{id}</div>
      <div data-gallery={id} className={canvas ? 'bg-canvas' : 'bg-surface'}>
        {children}
      </div>
    </div>
  );
}

const labels = Object.keys(labelMeta) as Label[];
const iconSamples = ([12, 13, 14, 18] as const).flatMap((size) =>
  labels.map((label) => ({
    size,
    label,
    drawn:
      size === 13 ||
      size === 14 ||
      (size === 12 && label !== 'error') ||
      (size === 18 && (label === 'checked' || label === 'recheck')),
  })),
);

function IconSamples({ drawn }: { drawn: boolean }) {
  return (
    <div className="flex flex-wrap gap-12px">
      {iconSamples
        .filter((sample) => sample.drawn === drawn)
        .map(({ size, label }) => {
          const id = `TrustIcon/${String(size)}-${label}`;
          return (
            <div key={id}>
              <Example id={id} canvas={size === 12}>
                <TrustIcon size={size} label={label} />
              </Example>
              <div className="text-12">{labelMeta[label]}</div>
            </div>
          );
        })}
    </div>
  );
}

function PillExamples({
  size,
  options,
  name,
}: {
  size: 'scope' | 'sort';
  options: string[];
  name: string;
}) {
  const [current, setCurrent] = useState(0);
  return (
    <div role="group" aria-label={name} className="flex flex-wrap gap-4px">
      {options.map((option, index) => (
        <Example
          key={option}
          id={`PillToggle/${size}-${index ? 'off' : 'on'}`}
          canvas={size === 'sort'}
        >
          <PillToggle
            size={size}
            pressed={current === index}
            onClick={() => {
              setCurrent(index);
            }}
          >
            {option}
          </PillToggle>
        </Example>
      ))}
    </div>
  );
}

function Tokens() {
  return (
    <section aria-labelledby="gallery-tokens">
      <h2 id="gallery-tokens" className="text-20 font-semibold">
        Tokens
      </h2>
      <ul className="flex flex-wrap gap-12px" data-gallery="Tokens/swatches">
        {Object.entries(themeTokens)
          .filter(([name]) => name.startsWith('--color-'))
          .map(([name, value]) => (
            <li key={name} className="text-12">
              <span
                className="block h-24px rounded-4 border border-edge"
                style={{ backgroundColor: `var(${name})` }}
                aria-hidden="true"
              />
              {name.slice('--color-'.length)} · {value}
            </li>
          ))}
      </ul>
    </section>
  );
}

export default function Gallery() {
  const [notice, setNotice] = useState('');
  return (
    <main id="gallery" className="flex flex-col gap-16px bg-surface p-16px">
      <h1 className="text-24 font-bold">Component gallery</h1>
      <Tokens />
      <section aria-labelledby="gallery-trust" className="flex flex-col gap-12px">
        <h2 id="gallery-trust" className="text-20 font-semibold">
          Trust
        </h2>
        <IconSamples drawn />
        <Example id="TrustBadge/inline">
          <TrustBadge variant="inline" label="reviewed" />
        </Example>
        <Example id="TrustBadge/link">
          <TrustBadge
            variant="link"
            label="recheck"
            context="Confocal microscopy, Principle"
            href="#gallery-trust"
          />
        </Example>
        <Example id="TrustBadge/section">
          <TrustBadge
            variant="section"
            label="reviewed"
            context="Overview"
            onClick={() => {
              setNotice('Overview: Reviewed');
            }}
          />
        </Example>
        <Example id="SpreadBar/md">
          <SpreadBar
            size="md"
            spread={{ checked: 41, reviewed: 46, recheck: 3, not_reviewed: 10 }}
            ariaLabel="41% checked against source, 46% reviewed, 3% under re-check, 10% not reviewed"
            caption="41% checked · 46% reviewed · 3% under re-check · 10% not reviewed"
          />
        </Example>
        <Example id="SpreadBar/sm">
          <SpreadBar
            size="sm"
            spread={{ checked: 1, reviewed: 2, recheck: 1, not_reviewed: 1 }}
            ariaLabel="5 sections: 1 checked, 2 reviewed, 1 under re-check, 1 not reviewed"
            caption="1 checked · 2 reviewed · 1 not reviewed"
          />
        </Example>
      </section>
      <section aria-labelledby="gallery-actions" className="flex flex-col gap-12px">
        <h2 id="gallery-actions" className="text-20 font-semibold">
          Actions and inline primitives
        </h2>
        <Example id="Button/primary-home" canvas>
          <Button variant="primary-home">Search</Button>
        </Example>
        <Example id="Button/primary">
          <Button className="w-full">Approve and publish</Button>
        </Example>
        <Example id="Button/secondary">
          {/* Reproduce the Review action row so its controls wrap and stretch together. */}
          <div className="flex flex-wrap gap-8px">
            {['Compare with current', 'Discuss'].map((label) => (
              <a
                key={label}
                href="#gallery-actions"
                className="rounded-8 border border-control bg-surface px-12px py-7px font-medium text-primary no-underline hover:text-primary"
              >
                {label}
              </a>
            ))}
            <Button variant="secondary">Re-run quality check</Button>
            <Button variant="secondary">Assign</Button>
          </div>
        </Example>
        <Example id="Button/secondary-compact">
          <Button variant="secondary-compact">Record source check for line 14</Button>
        </Example>
        <Example id="Button/disabled">
          <Button disabled className="w-full">
            Approval held by dispute
          </Button>
        </Example>
        <Example id="Button/link">
          <Button
            variant="link"
            onClick={() => {
              setNotice('Show anyway');
            }}
          >
            Show anyway
          </Button>
        </Example>
        <PillExamples
          size="scope"
          name="Recently updated"
          options={['Pages you use', 'All pages']}
        />
        <PillExamples size="sort" name="Sort" options={['Best match', 'Most checked first']} />
        <Example id="Chip/link" canvas>
          <Chip href="#gallery-actions">pinhole size</Chip>
        </Example>
        <Example id="CountBadge/default">
          <CountBadge count={4} />
        </Example>
        <Example id="AITag/default">
          <div className="flex items-center">
            <AITag />
          </div>
        </Example>
        <Example id="Mono/default">
          <span className="text-13 text-muted">
            <Mono>fix-pinhole-units</Mono>
          </span>
        </Example>
        <Example id="Mark/default">
          <span className="text-body-strong">
            <Mark>pinhole</Mark>
          </span>
        </Example>
        <p role="status">{notice}</p>
      </section>
      <section aria-labelledby="gallery-not-drawn" className="flex flex-col gap-12px">
        <h2 id="gallery-not-drawn" className="text-20 font-semibold">
          Not in frames (§6.1)
        </h2>
        <IconSamples drawn={false} />
        <p className="text-13 text-muted">
          Use the pointer to hover or hold down the controls below. Use Tab to see focus.
        </p>
        <Example id="Button/primary-hover-pressed">
          <Button>Approve and publish</Button>
        </Example>
        <Example id="Button/secondary-hover-pressed">
          <Button variant="secondary">Assign</Button>
        </Example>
        <Example id="Button/secondary-disabled">
          <Button variant="secondary" disabled>
            Assign
          </Button>
        </Example>
        <Example id="Button/loading">
          <Button loading>Approve and publish</Button>
        </Example>
        <Example id="PillToggle/off-hover-pressed">
          <PillToggle pressed={false}>All pages</PillToggle>
        </Example>
        <Example id="PillToggle/on-hover-pressed">
          <PillToggle pressed>Pages you use</PillToggle>
        </Example>
        <Example id="PillToggle/disabled">
          <PillToggle pressed={false} disabled>
            All pages
          </PillToggle>
        </Example>
      </section>
    </main>
  );
}
