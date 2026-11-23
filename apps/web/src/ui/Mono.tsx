import type { ReactNode } from 'react';

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono">{children}</span>;
}
