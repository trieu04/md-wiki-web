const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

export function formatDate(date: Date): string {
  return `${String(date.getUTCDate())} ${month.format(date)}`;
}

export function formatDateTime(date: Date): string {
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(date)} ${String(date.getUTCFullYear())}, ${hours}:${minutes} UTC`;
}

export function formatRelative(date: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)} d ago`;
  return date.getUTCFullYear() === now.getUTCFullYear()
    ? formatDate(date)
    : `${formatDate(date)} ${String(date.getUTCFullYear())}`;
}
