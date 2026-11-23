export function CountBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex h-count min-w-count items-center justify-center rounded-10 bg-primary px-6px text-12 leading-control font-semibold text-surface">
      {count}
    </span>
  );
}
