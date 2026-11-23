import { randomUUID } from 'node:crypto';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import type { SnippetDto, Wire } from './read.dto.js';

// Delimiters are per request, so wiki content cannot impersonate a highlight.
export function headlineMarkers() {
  const nonce = randomUUID();
  const start = `mw_start_${nonce}`;
  const stop = `mw_stop_${nonce}`;
  const separator = `mw_fragment_${nonce}`;
  return {
    start,
    stop,
    separator,
    options: `StartSel=${start}, StopSel=${stop}, FragmentDelimiter=${separator}, MaxFragments=2`,
  };
}

// ts_headline strips some tags on its own, but does not guarantee plain text.
function plainText(input: string): string {
  if (!input.includes('<')) return input;
  function text(node: DefaultTreeAdapterTypes.Node): string {
    if ('value' in node) return node.value;
    if ('tagName' in node && (node.tagName === 'script' || node.tagName === 'style')) return '';
    return 'childNodes' in node ? node.childNodes.map(text).join('') : '';
  }
  return text(parseFragment(input));
}

export function splitHeadline(
  headline: string,
  { start, stop, separator }: ReturnType<typeof headlineMarkers>,
): Wire<SnippetDto>[] {
  const snippets: Wire<SnippetDto>[] = [];
  const clear = (text: string) => text.replaceAll(start, '').replaceAll(stop, '');
  for (const fragment of plainText(headline).split(separator)) {
    const from = fragment.indexOf(start);
    if (from < 0) continue;
    const to = fragment.indexOf(stop, from + start.length);
    if (to < 0) continue;
    snippets.push({
      before: clear(fragment.slice(0, from)),
      hit: clear(fragment.slice(from + start.length, to)),
      after: clear(fragment.slice(to + stop.length)),
    });
    if (snippets.length === 2) break;
  }
  return snippets;
}
