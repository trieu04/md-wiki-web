import type { ComponentPropsWithoutRef } from 'react';

type ChipProps = ComponentPropsWithoutRef<'a'> & { href: string };

export function Chip({ className, ...props }: ChipProps) {
  return (
    <a
      {...props}
      className={`inline-block rounded-chip border border-control bg-surface px-10px py-5px text-13 text-primary no-underline hover:text-primary ${className ?? ''}`}
    />
  );
}
