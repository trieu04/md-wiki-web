/* global document, window */
// Projections leave the source frames and gallery crops unchanged. Remove whole
// deferred blocks before layout; mask individual cells, actions and meta text.
const recent = '#recent';
const result = 'main article';
export const phase3Projections = {
  Main: {
    omit: ['[aria-labelledby="notices-h"]', '[aria-labelledby="start-h"]', 'main > section > div'],
    mask: [
      `${recent} button:first-child`,
      `${recent} tbody td:first-child > div`,
      `${recent} tr > :nth-child(2)`,
      '[aria-labelledby="labels-h"] a',
    ],
  },
  Search: {
    omit: [],
    mask: [`${result} a[href="Trust.dc.html"]`, 'main a[href="Discussions.dc.html"]'],
    maskText: {
      selector: `${result} > span:last-child .sc-interp`,
      suffix: / · (?:written in \d{4} · )?used by \d+ teams?$/u.source,
    },
  },
};

export async function projectFrame(page, { omit, mask, maskText }) {
  if (omit.length) {
    await page.addStyleTag({
      content: omit.map((selector) => `${selector} { display: none !important; }`).join('\n'),
    });
  }
  return page.evaluate(
    ({ mask, maskText }) => {
      window.scrollTo(0, 0);
      for (const element of document.querySelectorAll('*'))
        if (element.scrollLeft || element.scrollTop) element.scrollTo(0, 0);
      function clippedRect(source, element) {
        let { left, right, top, bottom } = source;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = window.getComputedStyle(parent);
          const rect = parent.getBoundingClientRect();
          if (style.overflowX !== 'visible') {
            left = Math.max(left, rect.left + parent.clientLeft);
            right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth);
          }
          if (style.overflowY !== 'visible') {
            top = Math.max(top, rect.top + parent.clientTop);
            bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight);
          }
        }
        return right > left && bottom > top ? { left, right, top, bottom } : null;
      }
      const rects = mask.flatMap((selector) => {
        const nodes = [...document.querySelectorAll(selector)];
        if (!nodes.length) throw new Error(`Missing projection mask matches: ${selector}`);
        return nodes.map((el) => clippedRect(el.getBoundingClientRect(), el));
      });
      if (maskText) {
        for (const el of document.querySelectorAll(maskText.selector)) {
          for (const node of el.childNodes) {
            if (node.nodeType !== 3) continue;
            const match = new RegExp(maskText.suffix, 'u').exec(node.textContent);
            if (!match) continue;
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, node.length);
            for (const rect of range.getClientRects()) rects.push(clippedRect(rect, el));
          }
        }
      }
      return rects.filter(Boolean);
    },
    { mask, maskText },
  );
}
