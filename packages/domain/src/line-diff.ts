export interface DiffLine {
  kind: 'same' | 'del' | 'add';
  text: string;
  /** 1-based line in the old / new text, offset by the caller's first line. */
  oldLine: number | null;
  newLine: number | null;
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

// Beyond this edit distance the middle is reported as one replaced block: the diff
// stays correct (every line is accounted for) without quadratic memory.
const MAX_EDITS = 4000;

function middleDiff(a: string[], b: string[]): ('same' | 'del' | 'add')[] {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
          ? (v[offset + k + 1] ?? 0)
          : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [...a.map(() => 'del' as const), ...b.map(() => 'add' as const)];
  const ops: ('same' | 'del' | 'add')[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d] as Int32Array;
    const k = x - y;
    const down = k === -d || (k !== d && (prev[offset + k - 1] ?? 0) < (prev[offset + k + 1] ?? 0));
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('same');
      x--;
      y--;
    }
    ops.push(down ? 'add' : 'del');
    if (down) y--;
    else x--;
  }
  while (x > 0 && y > 0) {
    ops.push('same');
    x--;
    y--;
  }
  return ops.reverse();
}

/** Myers line diff; deletions come before additions inside a changed block. */
export function lineDiff(before: string, after: string, firstLine = 1): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const ops = [
    ...Array<'same'>(head).fill('same'),
    ...middleDiff(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...Array<'same'>(tail).fill('same'),
  ];
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === 'same') {
      out.push({ kind: 'same', text: b[j] ?? '', oldLine: firstLine + i, newLine: firstLine + j });
      i++;
      j++;
    } else if (op === 'del') {
      out.push({ kind: 'del', text: a[i] ?? '', oldLine: firstLine + i, newLine: null });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j] ?? '', oldLine: null, newLine: firstLine + j });
      j++;
    }
  }
  return out;
}

export interface DiffStats {
  changed: number;
  added: number;
  removed: number;
  footnotesAdded: number;
}
const footnote = /^\[\^[^\]]+\]:/;

/** Per changed block: paired lines count as changed, the rest as added or removed. */
export function diffStats(lines: readonly DiffLine[]): DiffStats {
  const stats: DiffStats = { changed: 0, added: 0, removed: 0, footnotesAdded: 0 };
  let del = 0;
  let add = 0;
  let footnotes = 0;
  const flush = () => {
    const paired = Math.min(del, add);
    stats.changed += paired;
    stats.removed += del - paired;
    stats.added += Math.max(0, add - paired - footnotes);
    stats.footnotesAdded += footnotes;
    del = add = footnotes = 0;
  };
  for (const line of lines) {
    if (line.kind === 'same') flush();
    else if (line.kind === 'del') del++;
    else {
      add++;
      if (footnote.test(line.text)) footnotes++;
    }
  }
  flush();
  return stats;
}
