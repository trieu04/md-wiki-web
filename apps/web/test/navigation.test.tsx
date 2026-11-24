import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { TopBar } from '../src/ui/TopBar';
import { WorkNav } from '../src/ui/WorkNav';
import { ReadingLayout } from '../src/ui/ReadingLayout';
import { WorkspaceLayout } from '../src/ui/WorkspaceLayout';

afterEach(cleanup);

it.each([
  ['home', 'Home'],
  ['browse', 'Browse'],
  ['recent', 'Recent changes'],
  ['search', null],
  ['you', 'MN — You: followed pages and your activity'],
  ['workspace', 'Workspace 4'],
  ['none', null],
] as const)('renders the TopBar %s current state', (active, expected) => {
  render(<TopBar active={active} workspaceCount={4} />);
  const banner = screen.getByRole('banner');
  const current = within(banner).queryAllByRole('link', { current: 'page' });
  if (expected) {
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(expected);
  } else {
    expect(current).toHaveLength(0);
  }
  if (active === 'you') expect(current[0]).toHaveClass('shadow-avatar');
});

it('omits Workspace for a reader and labels both the search and notifications', () => {
  const { rerender } = render(
    <TopBar role="reader" active="workspace" notificationCount={2} query="pinhole size" />,
  );
  expect(screen.queryByRole('link', { name: /Workspace/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /You:/ })).toHaveTextContent('LT');
  const form = screen.getByRole('search');
  expect(form).toHaveAttribute('action', '/search');
  const field = within(form).getByRole('searchbox', { name: 'Search the wiki' });
  expect(field).toHaveValue('pinhole size');
  expect(field).toHaveAttribute('name', 'q');
  const bell = screen.getByRole('button', { name: 'Notifications, 2 new' });
  expect(bell.querySelector('span')).toHaveAttribute('aria-hidden', 'true');
  rerender(<TopBar query="sample mounting" />);
  expect(screen.getByRole('searchbox')).toHaveValue('sample mounting');
  expect(screen.getByRole('link', { name: /You:/ })).toHaveTextContent('MN');
});

it('supports the native Tab order, ⌘K focus, search submission and keyboard notification activation', async () => {
  const onNotifications = vi.fn();
  const user = userEvent.setup();
  render(<TopBar onNotifications={onNotifications} />);
  const form = screen.getByRole<HTMLFormElement>('search');
  const search = screen.getByRole('searchbox');
  const submitted = vi.fn();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitted(new FormData(form).get('q'));
  });
  await user.tab();
  expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('link', { name: 'md-wiki Bioimaging core' })).toHaveFocus();
  await user.tab();
  expect(
    within(screen.getByRole('navigation', { name: 'Wiki' })).getByRole('link', { name: 'Home' }),
  ).toHaveFocus();
  await user.keyboard('{Meta>}k{/Meta}');
  expect(search).toHaveFocus();
  await user.keyboard('pinhole{Enter}');
  expect(submitted).toHaveBeenCalledWith('pinhole');
  await user.tab();
  expect(screen.getByRole('link', { name: 'Workspace' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Notifications' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(onNotifications).toHaveBeenCalledOnce();
});

it('skips to the main landmark and focuses it (D-252)', async () => {
  const user = userEvent.setup();
  render(
    <>
      <TopBar />
      <main>Body</main>
    </>,
  );
  await user.tab();
  await user.keyboard('{Enter}');
  const main = screen.getByRole('main');
  expect(main).toHaveFocus();
  expect(main).toHaveAttribute('tabindex', '-1');
});

it.each([
  ['inbox', 'Inbox'],
  ['proposals', 'Proposals'],
  ['discussions', 'Discussions'],
  ['recheck', 'Credibility'],
  ['mine', null],
  ['ops', 'Operations'],
  ['settings', 'Settings'],
] as const)('renders the WorkNav %s current state', (active, expected) => {
  render(<WorkNav active={active} />);
  const nav = screen.getByRole('navigation', { name: 'Workspace' });
  const current = within(nav).queryAllByRole('link', { current: 'page' });
  if (expected) {
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(expected);
  } else {
    expect(current).toHaveLength(0);
  }
});

it('distinguishes urgent counts from plain counts, renders footer status and tabs through the links', async () => {
  const user = userEvent.setup();
  render(
    <WorkNav
      counts={{ inbox: 4, proposals: 0 }}
      footer={{ reviewerStatus: 'reviewer-agent is on', autoPublishStatus: 'AUTO_PUBLISH on' }}
    />,
  );
  const nav = screen.getByRole('navigation', { name: 'Workspace' });
  expect(within(nav).getByText('4')).toHaveClass('bg-primary');
  expect(within(nav).getByText('0')).toHaveClass('text-muted');
  expect(within(nav).getByText('reviewer-agent is on')).toBeVisible();
  expect(within(nav).getByText('AUTO_PUBLISH on')).toBeVisible();
  await user.tab();
  expect(within(nav).getByRole('link', { name: 'Inbox 4' })).toHaveFocus();
  await user.tab();
  expect(within(nav).getByRole('link', { name: 'Proposals 0' })).toHaveFocus();
});

it('separates the reading toolbar, main content and complementary rail', () => {
  render(
    <ReadingLayout before="Lead" aside="Rail">
      Article
    </ReadingLayout>,
  );
  expect(screen.getByRole('banner')).toBeVisible();
  expect(screen.getByRole('main')).toHaveTextContent('LeadArticleRail');
  expect(screen.getByRole('complementary')).toHaveTextContent('Rail');
});

it('places the workspace menu before main content in keyboard order', async () => {
  const user = userEvent.setup();
  render(
    <WorkspaceLayout>
      <button>Content action</button>
    </WorkspaceLayout>,
  );
  const settings = within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', {
    name: 'Settings',
  });
  settings.focus();
  await user.tab();
  expect(
    within(screen.getByRole('main')).getByRole('button', { name: 'Content action' }),
  ).toHaveFocus();
});
