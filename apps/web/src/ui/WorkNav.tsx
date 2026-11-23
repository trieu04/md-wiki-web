import { CountBadge } from './CountBadge';

const groups = [
  {
    title: 'Your work',
    items: [
      ['inbox', 'Inbox', '/work', true, 'M3 13h5l1.5 2h5l1.5-2h5', 'M5.5 5h13L21 13v6H3v-6z'],
      [
        'proposals',
        'Proposals',
        '/work/proposals',
        false,
        'M3.5 6a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M3.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M15.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0',
        'M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-4',
      ],
      [
        'discussions',
        'Discussions',
        '/work/discussions',
        false,
        'M4 5h16v11H9l-5 4z',
        'M8 9.5h8M8 12.5h5',
      ],
    ],
  },
  {
    title: 'Trust',
    items: [
      [
        'recheck',
        'Credibility',
        '/work/credibility',
        true,
        'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z',
        'M9 12l2 2 4-4',
      ],
    ],
  },
  {
    title: 'Owner',
    items: [
      ['ops', 'Operations', '/work/ops', true, 'M3 12h4l3-7 4 14 3-7h4', ''],
      [
        'settings',
        'Settings',
        '/work/settings',
        false,
        'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
        'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
      ],
    ],
  },
] as const;

type WorkNavItemId = (typeof groups)[number]['items'][number][0];
export type WorkNavActive = WorkNavItemId | 'mine';
export type WorkNavProps = {
  active?: WorkNavActive;
  scope?: string;
  landmarkContext?: string;
  className?: string;
  counts?: Partial<Record<WorkNavItemId, number>>;
  footer?: { reviewerStatus: string; autoPublishStatus: string };
};

export function WorkNav({
  active = 'inbox',
  scope,
  landmarkContext,
  counts,
  footer,
  className = 'leading-control',
}: WorkNavProps) {
  return (
    <nav
      aria-label={landmarkContext ? `Workspace — ${landmarkContext}` : 'Workspace'}
      className={`flex min-h-workspace-nav-height w-full flex-col gap-16px border-r border-edge bg-surface px-12px py-18px ${className}`}
    >
      <div className="flex flex-col gap-2px px-8px">
        <strong className="text-15">Workspace</strong>
        {scope && <span className="text-12 text-muted">{scope}</span>}
      </div>
      {groups.map(({ title, items }) => (
        <div key={title} className="flex flex-col gap-work-nav-group-gap">
          <span className="px-10px pt-6px pb-4px text-11 font-semibold tracking-overline text-muted uppercase">
            {title}
          </span>
          {items.map(([id, label, href, strong, firstPath, secondPath]) => {
            const current = active === id;
            const count = counts?.[id];
            return (
              <a
                key={id}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={`flex items-center justify-between gap-8px rounded-7 px-10px py-8px no-underline hover:bg-nav-current active:bg-nav-current ${current ? 'bg-nav-current font-semibold text-primary' : 'font-nav text-secondary'}`}
              >
                <span className="inline-flex items-center gap-10px">
                  <svg
                    className="size-16px shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="var(--stroke-nav-icon)"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d={firstPath} />
                    {secondPath && <path d={secondPath} />}
                  </svg>
                  {label}
                </span>{' '}
                {count !== undefined &&
                  (strong ? (
                    <CountBadge count={count} />
                  ) : (
                    <span className="text-12 text-muted">{count}</span>
                  ))}
              </a>
            );
          })}
        </div>
      ))}
      {footer && (
        <div className="mt-auto flex flex-col gap-4px border-t border-edge px-10px pt-12px text-12 text-muted">
          <span>{footer.reviewerStatus}</span>
          <span>{footer.autoPublishStatus}</span>
        </div>
      )}
    </nav>
  );
}
