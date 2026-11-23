import type { Label } from '@md-wiki/domain';

const segments = [
  ['checked', 'bg-trust-checked'],
  ['reviewed', 'bg-trust-reviewed-bar'],
  ['recheck', 'bg-trust-recheck'],
  ['error', 'bg-trust-error'],
  ['not_reviewed', 'bg-trust-none-bar'],
] as const satisfies readonly (readonly [Label, string])[];

type SpreadBarProps = {
  size: 'sm' | 'md';
  spread: Partial<Record<Label, number>>;
  ariaLabel: string;
  caption: string;
  flowWithParent?: boolean;
};

export function SpreadBar({ size, spread, ariaLabel, caption, flowWithParent }: SpreadBarProps) {
  const small = size === 'sm';
  return (
    <div
      className={
        flowWithParent
          ? 'contents'
          : small
            ? 'flex flex-wrap items-center gap-x-16px gap-y-8px'
            : 'flex w-full flex-col gap-6px'
      }
    >
      <div
        role="img"
        aria-label={ariaLabel}
        className={`flex shrink-0 gap-2px overflow-hidden ${small ? 'h-spread-sm w-spread-sm-width rounded-spread-sm' : 'h-spread-md rounded-4'}`}
      >
        {segments.map(([label, background]) => {
          const weight = spread[label] ?? 0;
          return (
            weight > 0 && (
              <span
                key={label}
                aria-hidden="true"
                className={`min-w-0 basis-0 ${background}`}
                style={{ flexGrow: weight }}
              />
            )
          );
        })}
      </div>
      <span className={`text-secondary ${small ? 'text-13' : 'text-12'}`}>{caption}</span>
    </div>
  );
}
