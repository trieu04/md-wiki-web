import type { ReactNode } from 'react';

export function Mark({ children }: { children: ReactNode }) {
  return <mark className="rounded-mark bg-mark px-mark-x text-inherit">{children}</mark>;
}
