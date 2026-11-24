import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  title: string;
  context?: string;
  summary?: ReactNode;
  children: ReactNode;
};

/** Place after the page content in a wrapping flex row, as in F-04. */
export function Drawer({
  open,
  onClose,
  triggerRef,
  title,
  context,
  summary,
  children,
}: DrawerProps) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Focus moves to the heading on open and back to the trigger on close (D-39). The restore runs in
  // the layout phase (after React's own focus restore); a parent that unmounts the drawer instead of
  // passing open={false} gets the same restore from the unmount cleanup (P10-03, D-252).
  const restoreFocus = useRef(() => {
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) target.focus();
  });
  useLayoutEffect(() => {
    if (open) {
      opener.current = triggerRef.current;
      heading.current?.focus();
    } else restoreFocus.current();
  }, [open, triggerRef]);
  useLayoutEffect(() => {
    const restore = restoreFocus.current;
    return () => {
      restore();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const document = heading.current?.ownerDocument;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    document?.addEventListener('keydown', dismiss);
    return () => {
      document?.removeEventListener('keydown', dismiss);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={id}
      className="flex min-w-0 max-w-drawer-max grow shrink basis-drawer-basis flex-col border-l border-edge bg-surface"
    >
      <header className="flex flex-col gap-6px px-22px pt-18px pb-14px">
        <div className="flex items-start justify-between gap-12px">
          <div className="flex flex-col gap-2px">
            {context && <span className="text-13 text-muted">{context}</span>}
            <h2 id={id} ref={heading} tabIndex={-1} className="text-20 font-bold">
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="inline-flex size-icon-button shrink-0 items-center justify-center rounded-8 text-secondary hover:bg-nav-current active:bg-nav-current"
            onClick={onClose}
          >
            <svg
              className="size-icon-lg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="var(--stroke-control-icon)"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {summary}
      </header>
      {children}
    </section>
  );
}
