import { labelMeta } from '@md-wiki/domain';
import type { Label } from '@md-wiki/domain';
import { TrustIcon } from './TrustIcon';

type TrustBadgeProps = { label: Label } & (
  | { variant: 'inline' }
  | { variant: 'link'; href: string; context: string }
  | { variant: 'section'; onClick: () => void; context: string }
);

export function TrustBadge(props: TrustBadgeProps) {
  const { label, variant } = props;
  const words = labelMeta[label];
  const base = 'inline-flex items-center gap-7px whitespace-nowrap';
  const border = 'rounded-6 border border-edge text-primary';
  const contents = (
    <>
      <TrustIcon label={label} size={variant === 'section' ? 13 : 14} />
      {words}
    </>
  );
  if (variant === 'inline') return <span className={base}>{contents}</span>;
  const name = `${props.context}: ${words}. Why this label`;
  return variant === 'link' ? (
    <a
      className={`${base} ${border} px-8px py-3px text-13 no-underline hover:text-primary`}
      href={props.href}
      aria-label={name}
    >
      {contents}
    </a>
  ) : (
    <button
      className={`${base} ${border} bg-surface px-9px py-4px text-12 leading-control`}
      type="button"
      onClick={props.onClick}
      aria-label={name}
    >
      {contents}
    </button>
  );
}
