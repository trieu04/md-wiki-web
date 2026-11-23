import type { ReactNode } from 'react';

/** Dot colours drawn in F-09/F-10/F-07/F-13 status cells. */
const tones = {
  pending: 'bg-trust-reviewed-bar',
  escalated: 'bg-trust-recheck',
  error: 'bg-trust-error',
  publishing: 'bg-accent',
  published: 'bg-trust-checked',
  closed: 'bg-placeholder',
} as const;
export type StatusTone = keyof typeof tones;

/** 8px status dot followed by its words (status is never colour alone). */
export function StatusDot({
  tone,
  children,
  weight = 'medium',
}: {
  tone: StatusTone;
  children: ReactNode;
  weight?: 'medium' | 'semibold' | 'normal';
}) {
  const font = { medium: 'font-medium', semibold: 'font-semibold', normal: '' }[weight];
  return (
    <span className={`inline-flex items-center gap-7px ${font}`}>
      <span aria-hidden="true" className={`size-8px shrink-0 rounded-4 ${tones[tone]}`} />
      {children}
    </span>
  );
}
