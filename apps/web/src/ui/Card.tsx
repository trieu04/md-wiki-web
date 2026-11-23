import { useId } from 'react';
import type { ReactNode } from 'react';

type CardProps = {
  title: string;
  heading?: 'h2' | 'h3' | 'h4';
  header?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  state?: { type: 'loading' } | { type: 'empty'; message: string };
};

export function Card({
  title,
  heading: Heading = 'h2',
  header = false,
  actions,
  children,
  className = '',
  state,
}: CardProps) {
  const id = useId();
  const titleElement = (
    <Heading id={id} className="text-16 font-bold">
      {title}
    </Heading>
  );
  const hasHeader = header || actions != null || state?.type === 'loading';
  return (
    <section
      aria-labelledby={id}
      aria-busy={state?.type === 'loading' || undefined}
      className={`min-w-0 rounded-12 border border-edge bg-surface ${hasHeader ? 'overflow-hidden' : 'flex flex-col gap-6px px-18px py-16px'} ${className}`}
    >
      {hasHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-8px border-b border-divider px-18px py-14px">
          {titleElement}
          {actions}
        </div>
      ) : (
        titleElement
      )}
      {state?.type === 'loading' ? (
        <div className="flex flex-col gap-12px px-18px py-16px" aria-hidden="true">
          {[1, 2, 3].map((row) => (
            <div key={row} className="h-12px bg-row" />
          ))}
        </div>
      ) : state?.type === 'empty' ? (
        <p className={`text-13 text-muted ${hasHeader ? 'px-18px py-16px' : ''}`}>
          {state.message}
        </p>
      ) : (
        children
      )}
    </section>
  );
}
