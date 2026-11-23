export function nextLabel(existingLabelsForPathOnDate: readonly string[], now: Date): string {
  const prefix = now.toISOString().slice(0, 10).replaceAll('-', '') + '-';
  let highest = 0;
  for (const label of existingLabelsForPathOnDate) {
    if (label.startsWith(prefix)) highest = Math.max(highest, Number(label.slice(prefix.length)));
  }
  return prefix + String(highest + 1);
}
