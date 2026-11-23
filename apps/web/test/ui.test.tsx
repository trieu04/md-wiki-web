import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import frame from '../../../design/v4/Main.dc.html?raw';
import { AITag } from '../src/ui/AITag';
import { Button } from '../src/ui/Button';
import { Chip } from '../src/ui/Chip';
import { CountBadge } from '../src/ui/CountBadge';
import { Mark } from '../src/ui/Mark';
import { Mono } from '../src/ui/Mono';
import { PillToggle } from '../src/ui/PillToggle';
import { SpreadBar } from '../src/ui/SpreadBar';
import { TrustBadge } from '../src/ui/TrustBadge';
import { TrustIcon } from '../src/ui/TrustIcon';
import { labelMeta } from '@md-wiki/domain';
import type { Label } from '@md-wiki/domain';

const labels = Object.keys(labelMeta) as Label[];
const icons = ([12, 13, 14, 18] as const).flatMap((size) =>
  labels.map((label) => ({ size, label })),
);

afterEach(cleanup);

describe('TrustIcon', () => {
  it.each(icons)('keeps the frame paths byte-equal for $label at $size px', ({ label, size }) => {
    const sourceKey = label === 'not_reviewed' ? 'none' : label;
    const paths = frame.match(
      new RegExp(`^\\s*${sourceKey}: \\{ label: '[^']+', p1: '([^']*)',.*p2: '([^']*)'`, 'm'),
    );
    const { container } = render(<TrustIcon label={label} size={size} />);
    const svg = container.querySelector('svg');
    expect(paths).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox', '0 0 12 12');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    const actual = [...container.querySelectorAll('path')];
    expect(actual.map((path) => path.getAttribute('d'))).toEqual(paths?.slice(1));
    for (const path of actual)
      expect(path).toHaveAttribute(
        'stroke-width',
        size === 18 ? 'var(--stroke-trust-lg)' : 'var(--stroke-trust)',
      );
    expect(actual[1]).toHaveAttribute('stroke-linecap', 'round');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('TrustBadge', () => {
  it.each(labels)(
    'shows the words for %s without adding a focus stop to an inline badge',
    (label) => {
      render(<TrustBadge variant="inline" label={label} />);
      expect(screen.getByText(labelMeta[label])).toBeVisible();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    },
  );

  it('gives the link and button contextual names and native keyboard behavior', async () => {
    const user = userEvent.setup();
    const explain = vi.fn();
    const follow = vi.fn();
    render(
      <>
        <div
          onClick={(event) => {
            event.preventDefault();
            follow();
          }}
        >
          <TrustBadge variant="link" href="/why" label="checked" context="Guide, Overview" />
        </div>
        <TrustBadge variant="section" onClick={explain} label="recheck" context="Principle" />
      </>,
    );
    const link = screen.getByRole('link', {
      name: 'Guide, Overview: Checked against source. Why this label',
    });
    const button = screen.getByRole('button', {
      name: 'Principle: Under re-check. Why this label',
    });
    expect(link).toHaveAttribute('href', '/why');
    await user.tab();
    expect(link).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(follow).toHaveBeenCalledOnce();
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard(' ');
    expect(explain).toHaveBeenCalledOnce();
  });
});

describe('SpreadBar', () => {
  it.each(['md', 'sm'] as const)('exposes one named image and a visible caption (%s)', (size) => {
    render(
      <SpreadBar
        size={size}
        spread={{ checked: 2, reviewed: 0, recheck: 1 }}
        ariaLabel="3 sections: 2 checked, 1 under re-check"
        caption="2 checked · 1 under re-check"
      />,
    );
    const image = screen.getByRole('img', { name: '3 sections: 2 checked, 1 under re-check' });
    expect(screen.getByText('2 checked · 1 under re-check')).toBeVisible();
    expect([...image.children]).toHaveLength(2);
    expect(image.children[0]).toHaveStyle({ flexGrow: '2' });
    expect(image.children[1]).toHaveStyle({ flexGrow: '1' });
  });

  it('exposes the supplied zero-section label without rendering zero-width segments', () => {
    render(
      <SpreadBar
        size="sm"
        spread={{ checked: 0, reviewed: 0, recheck: 0, error: 0, not_reviewed: 0 }}
        ariaLabel="0 sections"
        caption="0 sections"
      />,
    );
    expect(screen.getByRole('img', { name: '0 sections' })).toBeEmptyDOMElement();
  });
});

describe('action primitives', () => {
  it('activates native buttons without accidentally submitting a surrounding form', async () => {
    const user = userEvent.setup();
    const click = vi.fn();
    const submit = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Button onClick={click}>Approve</Button>
        <Button variant="link" onClick={click}>
          Show anyway
        </Button>
        <Button variant="primary-home" type="submit">
          Search
        </Button>
      </form>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.keyboard(' ');
    expect(click).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(submit).toHaveBeenCalledOnce();
  });

  it.each(['primary', 'primary-home', 'secondary', 'secondary-compact', 'link'] as const)(
    'keeps disabled and busy %s buttons inert, with the label unchanged',
    async (variant) => {
      const user = userEvent.setup();
      const click = vi.fn();
      const { rerender } = render(
        <Button variant={variant} disabled onClick={click}>
          Save
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Save' });
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute('aria-busy', 'true');
      await user.click(button);
      expect(click).not.toHaveBeenCalled();
      rerender(
        <Button variant={variant} loading onClick={click}>
          Save
        </Button>,
      );
      expect(screen.getByRole('button', { name: 'Save', busy: true })).toBeDisabled();
      await user.tab();
      await user.keyboard('{Enter}');
      await user.click(button);
      expect(button).not.toHaveFocus();
      expect(click).not.toHaveBeenCalled();
      rerender(
        <Button variant={variant} onClick={click}>
          Save
        </Button>,
      );
      await user.tab();
      await user.keyboard('{Enter}');
      expect(click).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['primary', 'accent-hover'],
    ['primary-home', 'accent-hover'],
    ['secondary', 'nav-current'],
    ['secondary-compact', 'nav-current'],
  ] as const)('uses the approved hover and active tokens for %s', (variant, token) => {
    render(<Button variant={variant}>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(
      `enabled:hover:bg-${token}`,
      `enabled:active:bg-${token}`,
    );
  });

  it.each(['scope', 'sort'] as const)(
    'makes mutually exclusive %s pills keyboard-operable',
    async (size) => {
      function Group() {
        const [first, setFirst] = useState(true);
        return (
          <div role="group" aria-label="Scope">
            <PillToggle
              size={size}
              pressed={first}
              onClick={() => {
                setFirst(true);
              }}
            >
              One
            </PillToggle>
            <PillToggle
              size={size}
              pressed={!first}
              onClick={() => {
                setFirst(false);
              }}
            >
              Two
            </PillToggle>
            <PillToggle size={size} pressed={false} disabled>
              Unavailable
            </PillToggle>
          </div>
        );
      }
      const user = userEvent.setup();
      render(<Group />);
      const group = within(screen.getByRole('group', { name: 'Scope' }));
      const one = group.getByRole('button', { name: 'One', pressed: true });
      const two = group.getByRole('button', { name: 'Two', pressed: false });
      expect(one).toHaveClass(
        'border-accent',
        'bg-selected',
        'enabled:hover:bg-nav-current',
        'enabled:active:bg-nav-current',
      );
      expect(two).toHaveClass(
        'border-control',
        'bg-surface',
        'enabled:hover:bg-nav-current',
        'enabled:active:bg-nav-current',
      );
      expect(group.getByRole('button', { name: 'Unavailable', pressed: false })).toBeDisabled();
      await user.tab();
      await user.tab();
      expect(two).toHaveFocus();
      await user.keyboard(' ');
      expect(two).toHaveAttribute('aria-pressed', 'true');
      expect(one).toHaveAttribute('aria-pressed', 'false');
      await user.tab({ shift: true });
      await user.keyboard('{Enter}');
      expect(one).toHaveAttribute('aria-pressed', 'true');
    },
  );

  it('renders a link chip and noninteractive inline primitives', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Chip href="#results">pinhole size</Chip>
        <CountBadge count={0} />
        <CountBadge count={105} />
        <AITag />
        <Mono>fix-pinhole-units</Mono>
        <Mark>pinhole</Mark>
      </>,
    );
    const chip = screen.getByRole('link', { name: 'pinhole size' });
    expect(chip).toHaveAttribute('href', '#results');
    expect(screen.getByText('AI')).toBeVisible();
    expect(screen.getByText('0')).toBeVisible();
    expect(screen.getByText('105')).toBeVisible();
    expect(screen.getByText('fix-pinhole-units')).toHaveClass('font-mono');
    expect(screen.getByRole('mark')).toHaveTextContent('pinhole');
    await user.tab();
    expect(chip).toHaveFocus();
    await user.tab();
    expect(document.body).toHaveFocus();
  });
});
