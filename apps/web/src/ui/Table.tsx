import type { ReactNode } from 'react';

type TableProps = { label: string; children: ReactNode; widthClass?: string };

export function Table({ label, children, widthClass = 'min-w-table-home' }: TableProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="min-w-0 overflow-x-auto focus-visible:-outline-offset-2"
    >
      <table
        aria-label={label}
        className={`w-full border-collapse text-left [&_thead]:text-12 [&_thead]:text-muted [&_th]:font-semibold [&_tbody_tr]:align-top [&_tbody_tr]:border-t [&_tbody_tr]:border-row ${widthClass}`}
      >
        {children}
      </table>
    </div>
  );
}
