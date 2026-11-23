import type { Label } from '@md-wiki/domain';

type Path = { d: string; fill: string; stroke: string };
const white = 'var(--color-surface)';
const reviewed = 'var(--color-trust-reviewed)';
const paths: Record<Label, readonly [Path, Path]> = {
  checked: [
    {
      d: 'M.5 6a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0',
      fill: 'var(--color-trust-checked)',
      stroke: 'none',
    },
    { d: 'M3.5 6.2 5.2 7.8 8.5 4.4', fill: 'none', stroke: white },
  ],
  reviewed: [
    { d: 'M1 6a5 5 0 1 0 10 0a5 5 0 1 0-10 0', fill: 'none', stroke: reviewed },
    { d: 'M6 1a5 5 0 0 1 0 10z', fill: reviewed, stroke: 'none' },
  ],
  not_reviewed: [
    {
      d: 'M1.25 6a4.75 4.75 0 1 0 9.5 0a4.75 4.75 0 1 0-9.5 0',
      fill: 'none',
      stroke: 'var(--color-trust-none)',
    },
    { d: '', fill: 'none', stroke: 'none' },
  ],
  recheck: [
    { d: 'M6 .8 11.4 10.8H.6z', fill: 'var(--color-trust-recheck)', stroke: 'none' },
    { d: 'M6 4.6v2.8M6 8.6v.5', fill: 'none', stroke: white },
  ],
  error: [
    { d: 'M4 .8h4L11.2 4v4L8 11.2H4L.8 8V4z', fill: 'var(--color-trust-error)', stroke: 'none' },
    { d: 'M4.3 4.3l3.4 3.4M7.7 4.3 4.3 7.7', fill: 'none', stroke: white },
  ],
};
const sizes = {
  12: 'size-icon-sm',
  13: 'size-icon-badge-sm',
  14: 'size-icon-md',
  18: 'size-icon-lg',
} as const;

/** Decorative; pair with visible label words. */
export function TrustIcon({ label, size = 14 }: { label: Label; size?: keyof typeof sizes }) {
  const [first, second] = paths[label];
  const strokeWidth = size === 18 ? 'var(--stroke-trust-lg)' : 'var(--stroke-trust)';
  return (
    <svg
      className={`${sizes[size]} shrink-0`}
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <path {...first} strokeWidth={strokeWidth} />
      <path {...second} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
