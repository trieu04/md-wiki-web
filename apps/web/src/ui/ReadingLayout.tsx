import type { ReactNode } from 'react';
import { TopBar } from './TopBar';
import type { TopBarProps } from './TopBar';

export function ReadingLayout({
  topBar,
  before,
  aside,
  children,
  id,
  as: Main = 'main',
}: {
  topBar?: TopBarProps;
  before?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  id?: string;
  as?: 'main' | 'div';
}) {
  return (
    <div className="flex flex-col bg-canvas">
      <TopBar {...topBar} />
      <Main
        id={id}
        className="mx-auto flex w-full max-w-reading flex-col gap-28px px-24px pt-32px pb-48px"
      >
        {before}
        {aside == null ? (
          children
        ) : (
          <div className="flex flex-wrap items-start gap-20px">
            <div className="flex min-w-0 flex-reading-content flex-col gap-20px">{children}</div>
            <aside className="flex min-w-0 max-w-rail-max flex-auto basis-reading-aside flex-col gap-20px">
              {aside}
            </aside>
          </div>
        )}
      </Main>
    </div>
  );
}
