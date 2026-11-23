export function wikiPageHref(path: string, anchor?: string): string {
  const pathname = path.split('/').map(encodeURIComponent).join('/');
  return `/wiki/${pathname}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}

export function userInitials(name?: string): string {
  const words = name?.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? [];
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase())
    .join('');
}
