import { useEffect, useRef } from 'react';
import { CountBadge } from './CountBadge';
import { SearchInput } from './SearchInput';

export type TopBarActive = 'home' | 'browse' | 'recent' | 'search' | 'you' | 'workspace' | 'none';

export type TopBarProps = {
  active?: TopBarActive;
  role?: 'page author' | 'reader';
  query?: string;
  wikiName?: string;
  initials?: string;
  workspaceCount?: number;
  notificationCount?: number;
  onNotifications?: () => void;
  browseHref?: string;
  searchShortcut?: boolean;
  landmarkContext?: string;
};

export function TopBar({
  active = 'home',
  role = 'page author',
  query = '',
  wikiName = 'Bioimaging core',
  initials = role === 'reader' ? 'LT' : 'MN',
  workspaceCount,
  notificationCount = 0,
  onNotifications,
  browseHref = '/wiki/microscopy/basics.md',
  searchShortcut = true,
  landmarkContext,
}: TopBarProps) {
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!searchShortcut) return;
    function focusSearch(event: KeyboardEvent) {
      if (!event.defaultPrevented && event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        headerRef.current?.querySelector<HTMLInputElement>('input[type=search]')?.focus();
      }
    }
    window.addEventListener('keydown', focusSearch);
    return () => {
      window.removeEventListener('keydown', focusSearch);
    };
  }, [searchShortcut]);

  const links = [
    { id: 'home', label: 'Home', href: '/' },
    { id: 'browse', label: 'Browse', href: browseHref },
    { id: 'recent', label: 'Recent changes', href: '/#recent' },
  ] as const;
  const workspace = active === 'workspace';
  const you = active === 'you';
  return (
    <header
      ref={headerRef}
      className="flex min-h-topbar w-full flex-wrap items-center gap-x-22px gap-y-8px border-b border-edge bg-surface px-20px py-8px leading-control"
    >
      <a href="/" className="inline-flex items-center gap-10px text-primary no-underline">
        <span className="inline-flex size-28px items-center justify-center rounded-7 bg-primary text-surface">
          <svg
            className="size-16px"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="var(--stroke-brand-icon)"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 3h9l4 4v14H6z" />
            <path d="M9 12h7M9 16h5" />
          </svg>
        </span>
        <span className="flex flex-col leading-brand">
          <strong className="text-14">md-wiki</strong>{' '}
          <span className="text-12 text-muted">{wikiName}</span>
        </span>
      </a>
      <nav
        aria-label={landmarkContext ? `Wiki — ${landmarkContext}` : 'Wiki'}
        className="flex gap-2px"
      >
        {links.map(({ id, label, href }) => (
          <a
            key={id}
            href={href}
            aria-current={id === active ? 'page' : undefined}
            className={`rounded-7 px-10px py-8px no-underline hover:bg-nav-current active:bg-nav-current ${id === active ? 'bg-nav-current font-semibold text-primary' : 'font-medium text-secondary'}`}
          >
            {label}
          </a>
        ))}
      </nav>
      <SearchInput
        key={query}
        size="topbar"
        action="/search"
        formLabel={landmarkContext ? `Wiki search — ${landmarkContext}` : 'Wiki search'}
        name="q"
        label="Search the wiki"
        placeholder="Search pages, methods, instruments"
        defaultValue={query}
      />
      <div className="ml-auto flex items-center gap-6px">
        {role !== 'reader' && (
          <a
            href="/work"
            aria-current={workspace ? 'page' : undefined}
            className={`inline-flex items-center gap-8px rounded-8 border px-10px py-8px text-primary no-underline hover:bg-nav-current active:bg-nav-current ${workspace ? 'border-control bg-nav-current font-semibold' : 'border-transparent font-medium'}`}
          >
            <svg
              className="size-16px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="var(--stroke-nav-icon)"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 13h5l1.5 2h5l1.5-2h5" />
              <path d="M5.5 5h13L21 13v6H3v-6z" />
            </svg>
            Workspace {workspaceCount !== undefined && <CountBadge count={workspaceCount} />}
          </a>
        )}
        <button
          type="button"
          aria-label={
            notificationCount > 0
              ? `Notifications, ${String(notificationCount)} new`
              : 'Notifications'
          }
          onClick={onNotifications}
          className="relative inline-flex size-icon-button items-center justify-center rounded-8 text-secondary hover:bg-nav-current active:bg-nav-current"
        >
          <svg
            className="size-icon-lg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="var(--stroke-control-icon)"
            aria-hidden="true"
          >
            <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 19a2 2 0 0 0 4 0" />
          </svg>
          {notificationCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-9px right-10px box-content size-8px rounded-4 border-2 border-surface bg-trust-recheck"
            />
          )}
        </button>
        <a
          href="/me"
          aria-label={`${initials} — You: followed pages and your activity`}
          aria-current={you ? 'page' : undefined}
          className={`inline-flex size-avatar items-center justify-center rounded-17 bg-avatar text-12 font-semibold text-accent-hover no-underline ${you ? 'shadow-avatar' : ''}`}
        >
          {initials}
        </a>
      </div>
    </header>
  );
}
