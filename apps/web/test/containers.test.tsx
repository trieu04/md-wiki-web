import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContainerExamples, UndrawnContainerExamples } from '../src/ui/GalleryContainers';
import { FormExamples, UndrawnFormExamples } from '../src/ui/GalleryForms';
import { Drawer } from '../src/ui/Drawer';
import Gallery from '../src/ui/Gallery';

afterEach(cleanup);

it('gives counted tabs one tab stop, linked panels, and automatic keyboard activation', async () => {
  const user = userEvent.setup();
  render(<ContainerExamples />);
  const tabList = within(screen.getByRole('tablist', { name: 'State' }));
  const first = tabList.getByRole('tab', { name: 'Open 4', selected: true });
  const last = tabList.getByRole('tab', { name: 'All 64', selected: false });
  expect(last).toHaveAttribute('tabindex', '-1');
  first.focus();
  await user.keyboard('{ArrowLeft}');
  expect(last).toHaveFocus();
  expect(first).toHaveAttribute('tabindex', '-1');
  const panel = screen.getByRole('tabpanel', { name: 'All 64' });
  expect(last).toHaveAttribute('aria-controls', panel.id);
  expect(panel).toHaveAttribute('aria-labelledby', last.id);
  expect(screen.queryByRole('tabpanel', { name: 'Open 4' })).not.toBeInTheDocument();
  await user.keyboard('{ArrowRight}');
  expect(first).toHaveFocus();
  await user.keyboard('{End}');
  expect(last).toHaveFocus();
  await user.keyboard('{Home}');
  expect(first).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('tabpanel', { name: 'Open 4' })).toHaveFocus();
  await user.click(tabList.getByRole('tab', { name: 'Stale 1' }));
  expect(screen.getByRole('tabpanel', { name: 'Stale 1' })).toBeVisible();
});

it('names the card and the keyboard-scrollable table, preserving native column headers', () => {
  render(<ContainerExamples />);
  const card = within(screen.getByRole('region', { name: 'Recently updated' }));
  expect(card.getByRole('heading', { name: 'Recently updated' })).toBeInTheDocument();
  const scroll = card.getByRole('region', { name: 'Recently updated pages' });
  expect(scroll).toHaveAttribute('tabindex', '0');
  scroll.focus();
  expect(scroll).toHaveFocus();
  const table = within(scroll).getByRole('table', { name: 'Recently updated pages' });
  expect(within(table).getByRole('columnheader', { name: 'What changed' })).toHaveAttribute(
    'scope',
    'col',
  );
  expect(within(table).getAllByRole('row')).toHaveLength(4);
});

it('exposes the intended callout roles and the undrawn loading, empty and query-error states', () => {
  render(
    <>
      <ContainerExamples />
      <UndrawnContainerExamples />
    </>,
  );
  expect(screen.getByRole('note')).toHaveTextContent('Use with care');
  expect(screen.getByRole('status')).toHaveTextContent('Source check saved');
  expect(screen.getByText('Publish outcome unknown.').closest('[role=alert]')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Decision' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Agent review AI' })).toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: 'Recently updated (loading)', busy: true }),
  ).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Recently updated (empty)' })).toHaveTextContent(
    'Follow pages you rely on to hear when they change.',
  );
  expect(
    screen.getByRole('button', { name: 'Try again' }).closest('[role=alert]'),
  ).toBeInTheDocument();
});

function DrawerFixture({ outside }: { outside: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        onClick={() => {
          setOpen(true);
        }}
      >
        Show details
      </button>
      <Drawer
        title="Details"
        open={open}
        triggerRef={trigger}
        onClose={() => {
          setOpen(false);
        }}
      >
        <button type="button">Panel action</button>
      </Drawer>
      <button type="button" onClick={outside}>
        Outside action
      </button>
    </>
  );
}

it('moves focus in on open, allows Tab to leave, and restores opener focus on Escape and Close', async () => {
  const user = userEvent.setup();
  const outside = vi.fn();
  render(<DrawerFixture outside={outside} />);
  const trigger = screen.getByRole('button', { name: 'Show details' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Details' });
  expect(dialog).toHaveAttribute('aria-modal', 'false');
  expect(within(dialog).getByRole('heading')).toHaveFocus();
  await user.tab();
  expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
  await user.tab();
  expect(within(dialog).getByRole('button', { name: 'Panel action' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Outside action' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(outside).toHaveBeenCalledOnce();
  expect(dialog).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(dialog).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('has no axe violations in the new gallery sections or undrawn states', async () => {
  const { container } = render(
    <main>
      <h1>Component gallery</h1>
      <FormExamples />
      <ContainerExamples />
      <UndrawnFormExamples />
      <UndrawnContainerExamples />
    </main>,
  );
  // JSDOM does not provide the rendered pixels needed by the contrast rule.
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(
    result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target) })),
  ).toEqual([]);
});

it('keeps the original PillToggle crop IDs attached to the live on and off states', async () => {
  const user = userEvent.setup();
  render(<Gallery />);
  for (const [name, type, target, initial] of [
    ['Recently updated', 'scope', 'All pages', 'Pages you use'],
    ['Sort', 'sort', 'Most checked first', 'Best match'],
  ] as const) {
    const group = within(screen.getByRole('group', { name }));
    await user.click(group.getByRole('button', { name: target }));
    expect(
      group.getByRole('button', { name: target, pressed: true }).closest('[data-gallery]'),
    ).toHaveAttribute('data-gallery', `PillToggle/${type}-on`);
    expect(
      group.getByRole('button', { name: initial, pressed: false }).closest('[data-gallery]'),
    ).toHaveAttribute('data-gallery', `PillToggle/${type}-off`);
  }
});
