export type DiffRow = {
  kind: 'add' | 'del' | 'same' | 'gap';
  number: number | null;
  text: string;
  /** F-10: `text` split around quality-check quotes (wavy AI underline). */
  parts?: readonly { text: string; mark: boolean }[];
};

function RowText({ row }: { row: DiffRow }) {
  if (!row.parts) return <>{row.text}</>;
  return (
    <>
      {row.parts.map((part, index) =>
        part.mark ? (
          <span key={index} className="underline decoration-ai decoration-wavy underline-offset-3">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

const tones = {
  add: { className: 'bg-trust-checked-bg text-trust-checked-fg', sign: '+', label: 'Added' },
  del: { className: 'bg-trust-error-bg text-trust-error-fg', sign: '−', label: 'Removed' },
} as const;

/**
 * F-06/F-10 Changes: a line diff numbered in the page (design-system §5). F-10 adds unchanged
 * context lines (`same`, muted number), collapsed runs (`gap`) and a heading line.
 */
export function DiffView({
  rows,
  label = 'Changes',
  empty = 'No changes yet.',
  heading,
  anchors = false,
}: {
  rows: readonly DiffRow[];
  label?: string;
  empty?: string;
  heading?: string;
  /** F-10: `id="line-N"` on rows of the new text, the targets of quality findings. */
  anchors?: boolean;
}) {
  const anchor = (row: DiffRow) =>
    anchors && row.kind !== 'del' && row.number !== null ? `line-${String(row.number)}` : undefined;
  if (!rows.length) return <p className="px-16px py-14px text-13 text-muted">{empty}</p>;
  return (
    <div className="py-10px">
      {heading && <p className="pb-4px pl-16px font-ui text-12 text-muted">{heading}</p>}
      <ol
        aria-label={label}
        className="m-0 list-none pl-0 font-mono text-13 leading-diff wrap-anywhere"
      >
        {rows.map((row, index) => {
          if (row.kind === 'gap')
            return (
              <li key={index} className="flex bg-canvas py-4px text-muted">
                <span className="w-diff-number shrink-0" />
                <span className="w-diff-sign shrink-0" />
                <span className="font-ui text-12 leading-base">{row.text}</span>
              </li>
            );
          if (row.kind === 'same')
            return (
              <li key={index} id={anchor(row)} className="flex">
                <span className="w-diff-number shrink-0 pr-14px text-right text-placeholder">
                  {row.number ?? ''}
                </span>
                <span className="w-diff-sign shrink-0" />
                <span className="min-w-0 flex-1 whitespace-pre-wrap">
                  <RowText row={row} />
                </span>
              </li>
            );
          const tone = tones[row.kind];
          return (
            <li key={index} id={anchor(row)} className={`flex ${tone.className}`}>
              <span className="w-diff-number shrink-0 pr-14px text-right">{row.number ?? ''}</span>
              <span className="w-diff-sign shrink-0">
                <span aria-hidden="true">{tone.sign}</span>
                <span className="sr-only">{tone.label}</span>
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap">
                <RowText row={row} />
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
