import { useId } from 'react';
import type { ReactNode } from 'react';
import { AITag } from './AITag';

type CalloutProps =
  | { tone: 'warn'; title?: string; children: ReactNode }
  | { tone: 'success'; title: string; children: ReactNode }
  | { tone: 'error'; title: string; children: ReactNode; action?: ReactNode; queryError?: boolean }
  | {
      tone: 'info' | 'ai';
      title: string;
      children: ReactNode;
      label?: string;
      heading?: 'h2' | 'h3' | 'h4';
    };

export function Callout(props: CalloutProps) {
  const { tone, title, children } = props;
  const id = useId();
  switch (tone) {
    case 'warn':
      return (
        <div
          role="note"
          className="flex flex-col gap-4px rounded-8 bg-trust-recheck-bg px-14px py-10px text-13 text-trust-recheck-note-fg"
        >
          {title && <strong className="font-semibold">{title}</strong>}
          {children}
        </div>
      );
    case 'success':
      return (
        <div
          role="status"
          className="flex items-start gap-12px rounded-10 border border-trust-checked-border bg-trust-checked-saved-bg px-16px py-14px"
        >
          <svg
            className="size-20px shrink-0 text-trust-checked"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="var(--stroke-success-icon)"
            aria-hidden="true"
          >
            <path d="M4 12.5 9 17.5 20 6.5" />
          </svg>
          <div className="flex flex-col">
            <strong className="font-semibold">{title}</strong>
            <div className="text-secondary">{children}</div>
          </div>
        </div>
      );
    case 'error':
      return (
        <div
          role="alert"
          className={`flex flex-wrap items-center justify-between gap-x-16px gap-y-8px rounded-10 border border-trust-error-border px-16px py-12px ${props.queryError ? 'bg-trust-error-bg text-trust-error-fg' : 'bg-surface'}`}
        >
          <div>
            <strong className="font-bold">{title}</strong> {children}
          </div>
          {props.action}
        </div>
      );
    default: {
      const Heading = props.heading ?? 'h2';
      return (
        <section
          aria-label={props.label}
          aria-labelledby={props.label == null ? id : undefined}
          className={`flex flex-col rounded-10 border bg-surface px-18px py-16px ${tone === 'ai' ? 'gap-8px border-edge' : 'gap-12px border-accent-tint'}`}
        >
          <Heading id={id} className="flex items-center gap-8px text-14 font-bold">
            {title}
            {tone === 'ai' && (
              <>
                {' '}
                <AITag />
              </>
            )}
          </Heading>
          {children}
        </section>
      );
    }
  }
}
