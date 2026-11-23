import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export type Tab = { id: string; label: string; count?: number; panel: ReactNode };

type TabsProps = {
  label: string;
  tabs: readonly Tab[];
  selected: string;
  onChange: (id: string) => void;
  variant?: 'workspace' | 'activity' | 'drawer';
  /** Controls drawn on the tab bar's right (F-06 formatting toolbar). */
  actions?: ReactNode;
};

const styles = {
  workspace: { list: 'px-10px', button: 'px-12px py-10px text-14', count: 'text-trust-none' },
  activity: { list: 'px-12px', button: 'px-12px py-tabs-activity text-14', count: 'text-muted' },
  drawer: { list: 'mx-22px', button: 'px-10px py-10px text-13', count: 'text-muted' },
};

export function Tabs({
  label,
  tabs,
  selected,
  onChange,
  variant = 'workspace',
  actions,
}: TabsProps) {
  const uid = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const style = styles[variant];
  const active = tabs.find((tab) => tab.id === selected) ?? tabs[0];

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = (index - 1 + tabs.length) % tabs.length;
        break;
      case 'ArrowRight':
        next = (index + 1) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const tab = tabs[next];
    if (tab) {
      buttons.current.get(tab.id)?.focus();
      if (tab !== active) onChange(tab.id);
    }
  }

  const tabId = (id: string) => `${uid}-tab-${id}`;
  const panelId = (id: string) => `${uid}-panel-${id}`;

  const tablist = (
    <div
      role="tablist"
      aria-label={label}
      className={
        actions == null
          ? `flex flex-wrap gap-2px border-b border-edge ${style.list}`
          : 'flex gap-2px'
      }
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(node) => {
            if (node) buttons.current.set(tab.id, node);
            else buttons.current.delete(tab.id);
          }}
          type="button"
          role="tab"
          id={tabId(tab.id)}
          aria-controls={panelId(tab.id)}
          aria-selected={tab === active}
          tabIndex={tab === active ? 0 : -1}
          onKeyDown={(event) => {
            navigate(event, index);
          }}
          onClick={() => {
            if (tab !== active) onChange(tab.id);
          }}
          className={`-mb-mark-x border-b-2 leading-control focus-visible:relative focus-visible:z-10 ${style.button} ${tab === active ? 'border-accent font-semibold text-primary' : 'border-transparent font-medium text-muted'}`}
        >
          {tab.label}
          {tab.count != null && (
            <>
              {' '}
              <span className={`font-medium ${style.count}`}>{tab.count}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-w-0">
      {actions == null ? (
        tablist
      ) : (
        <div
          className={`flex flex-wrap items-center justify-between gap-6px border-b border-edge ${style.list}`}
        >
          {tablist}
          {actions}
        </div>
      )}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={panelId(tab.id)}
          role="tabpanel"
          aria-labelledby={tabId(tab.id)}
          hidden={tab !== active}
          tabIndex={0}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
