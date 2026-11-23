export type DiffRow = { kind: 'add' | 'del'; number: number | null; text: string };

const tones = {
  add: { className: 'bg-trust-checked-bg text-trust-checked-fg', sign: '+', label: 'Added' },
  del: { className: 'bg-trust-error-bg text-trust-error-fg', sign: '−', label: 'Removed' },
} as const;

/** F-06 Changes: the changed lines of a line diff, numbered in the page (design-system §5). */
export function DiffView({
  rows,
  label = 'Changes',
  empty = 'No changes yet.',
}: {
  rows: readonly DiffRow[];
  label?: string;
  empty?: string;
}) {
  if (!rows.length) return <p className="px-16px py-14px text-13 text-muted">{empty}</p>;
  return (
    <ol
      aria-label={label}
      className="m-0 list-none py-10px pl-0 font-mono text-13 leading-diff wrap-anywhere"
    >
      {rows.map((row, index) => {
        const tone = tones[row.kind];
        return (
          <li key={index} className={`flex ${tone.className}`}>
            <span className="w-diff-number shrink-0 pr-14px text-right">{row.number ?? ''}</span>
            <span className="w-diff-sign shrink-0">
              <span aria-hidden="true">{tone.sign}</span>
              <span className="sr-only">{tone.label}</span>
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{row.text}</span>
          </li>
        );
      })}
    </ol>
  );
}
