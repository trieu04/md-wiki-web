export type MarkdownFormat = 'bold' | 'italic' | 'heading' | 'link' | 'footnote' | 'table';

const tools: readonly { format: MarkdownFormat; label: string; aria: string }[] = [
  { format: 'bold', label: 'B', aria: 'Bold' },
  { format: 'italic', label: 'I', aria: 'Italic' },
  { format: 'heading', label: 'H', aria: 'Heading' },
  { format: 'link', label: '[ ]', aria: 'Link' },
  { format: 'footnote', label: '¹', aria: 'Footnote' },
  { format: 'table', label: '⊞', aria: 'Table' },
];

/** F-06 formatting buttons; the text transform lives in the editor model. */
export function MarkdownToolbar({
  onFormat,
  disabled = false,
}: {
  onFormat: (format: MarkdownFormat) => void;
  disabled?: boolean;
}) {
  return (
    <div role="toolbar" aria-label="Formatting" className="flex gap-2px py-6px">
      {tools.map(({ format, label, aria }) => (
        <button
          key={format}
          type="button"
          aria-label={aria}
          disabled={disabled}
          // Keep the textarea selection: the click must not move focus first.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            onFormat(format);
          }}
          className="min-w-30px rounded-6 bg-transparent px-8px py-4px text-13 font-semibold text-secondary enabled:hover:bg-nav-current disabled:cursor-not-allowed disabled:text-muted"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
