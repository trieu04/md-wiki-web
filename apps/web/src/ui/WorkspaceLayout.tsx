import type { ReactNode } from 'react';
import { TopBar } from './TopBar';
import type { TopBarProps } from './TopBar';
import { WorkNav } from './WorkNav';
import type { WorkNavProps } from './WorkNav';

export function WorkspaceLayout({
  topBar,
  workNav,
  children,
  as: Main = 'main',
}: {
  topBar?: TopBarProps;
  workNav?: WorkNavProps;
  children?: ReactNode;
  as?: 'main' | 'div';
}) {
  return (
    <div className="flex flex-col bg-canvas">
      <TopBar active="workspace" {...topBar} />
      <div className="flex flex-auto flex-wrap items-stretch">
        <div className="flex max-w-rail-min flex-auto basis-workspace-nav">
          <WorkNav className="leading-base" {...workNav} />
        </div>
        <Main className="flex min-w-0 max-w-workspace flex-workspace-content flex-col gap-16px px-28px pt-20px pb-40px">
          {children}
        </Main>
      </div>
    </div>
  );
}
