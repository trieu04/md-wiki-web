import { useId, type ReactNode } from 'react';
import { AITag } from '../../ui/AITag';
import type { FindingRow, QualityCard } from './model';

function FindingText({ row }: { row: FindingRow }) {
  return (
    <>
      <strong className="font-semibold">
        {row.place} · {row.severity} ·
      </strong>{' '}
      {row.message}
      <span className="block text-12 text-muted">
        “{row.quote}”{row.original !== null && <> · source said “{row.original}”</>}
      </span>
    </>
  );
}

/**
 * F-10 *Quality check* and F-06 *Self-check* (AI) cards (system-logic §7.6, D-148). Render only:
 * `card` comes from `qualityCard`. Review findings on proposal lines link to the Changes row.
 */
export function QualityCheckCard({
  title,
  card,
  variant,
  action,
  footer,
  error,
  onLine,
}: {
  title: string;
  card: QualityCard | null;
  variant: 'review' | 'editor';
  action?: ReactNode;
  footer?: string;
  /** A failed run/re-run request (the card keeps its last content). */
  error?: string | null | undefined;
  onLine?: (line: number) => void;
}) {
  const id = useId();
  const heading = (
    <h2 id={id} className="flex items-center gap-8px text-14 font-bold">
      {title} <AITag />
    </h2>
  );
  return (
    <section
      aria-labelledby={id}
      aria-busy={card === null || card.active || undefined}
      className="flex flex-col gap-8px rounded-10 border border-edge bg-surface px-18px py-16px"
    >
      {action ? (
        <div className="flex items-center justify-between gap-8px">
          {heading}
          {action}
        </div>
      ) : (
        heading
      )}
      {card === null ? (
        <div className="flex flex-col gap-8px" aria-hidden="true">
          {[1, 2].map((row) => (
            <div key={row} className="h-12px bg-row" />
          ))}
        </div>
      ) : (
        <>
          {card.note && <p className="text-13 text-secondary">{card.note}</p>}
          {card.rows.length > 0 &&
            (variant === 'review' ? (
              <ul aria-label="Findings" className="m-0 flex list-none flex-col gap-8px p-0 text-13">
                {card.rows.map((row) => (
                  <li key={row.key}>
                    {row.line !== null && onLine ? (
                      <a
                        href={`#line-${String(row.line)}`}
                        className="text-primary no-underline hover:text-primary"
                        onClick={(event) => {
                          event.preventDefault();
                          onLine(row.line ?? 0);
                        }}
                      >
                        <FindingText row={row} />
                      </a>
                    ) : (
                      <FindingText row={row} />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <ul
                aria-label="Findings"
                className="m-0 flex list-disc flex-col gap-3px pl-18px text-13 text-secondary"
              >
                {card.rows.map((row) => (
                  <li key={row.key}>
                    <FindingText row={row} />
                  </li>
                ))}
              </ul>
            ))}
          {card.flags.length > 0 && (
            <span className="text-12 font-semibold text-secondary">
              Flags: {card.flags.join(' · ')}
            </span>
          )}
          {card.meta && <span className="text-12 text-trust-none">{card.meta}</span>}
        </>
      )}
      {error && (
        <p role="alert" className="text-12 text-trust-error-fg">
          {error}
        </p>
      )}
      {footer && <span className="text-12 text-trust-none">{footer}</span>}
    </section>
  );
}
