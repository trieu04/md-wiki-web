import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { alignBelowTopBars, diffPng, PIXELMATCH_THRESHOLD } from './diff.mjs';

const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

export async function writeReport(reportRoot, task, images) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(task)) throw new Error(`Invalid task ID: ${task}`);
  await mkdir(reportRoot, { recursive: true });
  const stage = await mkdtemp(join(reportRoot, '.visual-'));
  const destination = join(reportRoot, task);
  const results = [];
  try {
    const sections = [];
    for (const {
      label,
      reference,
      actual,
      maskRows,
      maskRects,
      referenceTopBar,
      actualTopBar,
      height,
    } of images) {
      const folder = `image-${results.length + 1}`;
      await mkdir(join(stage, folder));
      if (!reference) {
        results.push({ label });
        const src = `${folder}/actual.png`;
        await writeFile(join(stage, src), actual);
        sections.push(`<section>
<h2>${escapeHtml(label)}</h2>
<p>Derived screen (D-16): no reference frame or pixel score.</p>
<a href="${src}"><img loading="lazy" alt="${escapeHtml(label)}" src="${src}"></a>
</section>`);
        continue;
      }
      let comparison = [reference, actual];
      let mask = maskRows;
      let details = maskRows ? ` · top ${maskRows}px masked` : '';
      let beforePercent;
      if (referenceTopBar && actualTopBar) {
        beforePercent = diffPng(reference, actual, { maskRows }).percent;
        comparison = alignBelowTopBars(
          reference,
          actual,
          referenceTopBar.bottom,
          actualTopBar.bottom,
          height,
        );
        mask = 0;
        details =
          ` · aligned below TopBar (reference ${referenceTopBar.bottom}px, actual ${actualTopBar.bottom}px)` +
          `<br>TopBar widths: reference ${referenceTopBar.width.toFixed(1)}px, actual ${actualTopBar.width.toFixed(1)}px. Fixed ${maskRows}px mask before alignment: ${beforePercent.toFixed(4)}%.`;
        await Promise.all([
          writeFile(join(stage, folder, 'reference-full.png'), reference),
          writeFile(join(stage, folder, 'actual-full.png'), actual),
        ]);
        details += ` <a href="${folder}/reference-full.png">Full reference</a> · <a href="${folder}/actual-full.png">Full actual</a>`;
      }
      const diff = diffPng(...comparison, { maskRows: mask, maskRects });
      const { mismatchPixels, comparedPixels, percent } = diff;
      results.push({
        label,
        mismatchPixels,
        comparedPixels,
        percent,
        ...(beforePercent != null && { beforePercent }),
      });
      await Promise.all([
        writeFile(join(stage, folder, 'reference.png'), comparison[0]),
        writeFile(join(stage, folder, 'actual.png'), comparison[1]),
        writeFile(join(stage, folder, 'diff.png'), diff.png),
      ]);
      const mismatch = percent > 0 && percent < 0.0001 ? '&lt;0.0001' : percent.toFixed(4);
      sections.push(`<section>
<h2>${escapeHtml(label)}</h2>
<p><strong>${mismatch}% mismatch</strong> (${mismatchPixels} / ${comparedPixels} pixels)${details}${maskRects?.length ? ` · ${maskRects.length} deferred regions masked` : ''}</p>
<div class="comparison">${['Reference', 'Actual', 'Diff']
        .map((name) => {
          const src = `${folder}/${name.toLowerCase()}.png`;
          return `<figure><figcaption>${name}</figcaption><a href="${src}"><img loading="lazy" alt="${name}: ${escapeHtml(label)}" src="${src}"></a></figure>`;
        })
        .join('')}</div>
</section>`);
    }
    await writeFile(
      join(stage, 'index.html'),
      `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual report · ${escapeHtml(task)}</title>
<style>
body { font: 16px system-ui, sans-serif; margin: 24px; }
.comparison { display: flex; gap: 12px; overflow-x: auto; align-items: flex-start; }
figure { margin: 0; }
img { display: block; border: 1px solid #bbb; }
</style>
<h1>Visual report · ${escapeHtml(task)}</h1>
<p>Pixelmatch threshold: ${PIXELMATCH_THRESHOLD}. Red pixels differ; masked regions are transparent. Open an image for the original PNG.</p>
${sections.join('\n')}
</html>`,
    );
    await rm(destination, { recursive: true, force: true });
    await rename(stage, destination);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return { index: join(destination, 'index.html'), results };
}
