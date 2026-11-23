import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffPng, PIXELMATCH_THRESHOLD } from './diff.mjs';

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
    for (const { label, reference, actual, maskRows } of images) {
      const folder = `image-${results.length + 1}`;
      const diff = diffPng(reference, actual, { maskRows });
      const { mismatchPixels, comparedPixels, percent } = diff;
      results.push({ label, mismatchPixels, comparedPixels, percent });
      await mkdir(join(stage, folder));
      await Promise.all([
        writeFile(join(stage, folder, 'reference.png'), reference),
        writeFile(join(stage, folder, 'actual.png'), actual),
        writeFile(join(stage, folder, 'diff.png'), diff.png),
      ]);
      const mismatch = percent > 0 && percent < 0.0001 ? '&lt;0.0001' : percent.toFixed(4);
      sections.push(`<section>
<h2>${escapeHtml(label)}</h2>
<p><strong>${mismatch}% mismatch</strong> (${mismatchPixels} / ${comparedPixels} pixels)${maskRows ? ` · top ${maskRows}px masked` : ''}</p>
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
