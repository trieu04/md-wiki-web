/* global fetch */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';
import canvas from '../../design/v4/canvas.json' with { type: 'json' };
import { loadRuntime } from './render.mjs';
import { serve, variantDocument } from './serve.mjs';
import frames from './variants.json' with { type: 'json' };

const designFile = (relativePath) =>
  readFile(new URL(`../../design/${relativePath}`, import.meta.url), 'utf8');

test('serves unchanged frames and runtime, with wrappers at sibling URLs', async (t) => {
  const { origin, pages, close } = await serve(frames, await loadRuntime());
  t.after(close);
  assert.equal(pages.get('Page/resolution'), '/Page.dc.html');
  const original = await fetch(`${origin}${pages.get('Page/resolution')}`);
  assert.equal(original.status, 200);
  assert.match(original.headers.get('content-type'), /^text\/html/);
  assert.equal(await original.text(), await designFile('v4/Page.dc.html'));
  const runtime = await fetch(`${origin}/support.js`);
  assert.match(runtime.headers.get('content-type'), /^text\/javascript/);
  assert.equal(await runtime.text(), await designFile('runtime/support.js'));
  const wrapper = await fetch(`${origin}${pages.get('Editor/base-changed')}`);
  assert.equal(wrapper.status, 200);
  assert.match(await wrapper.text(), /<dc-import name="Editor" dc-props="{{ props }}">/);
  assert.equal((await fetch(`${origin}/%2e%2e/package.json`)).status, 404);
  assert.equal((await fetch(`${origin}/Main.dc.html`, { method: 'POST' })).status, 405);
});

test('wrappers preserve booleans and escape strings that would end the logic script', () => {
  const props = { baseChanged: false, query: '"<&</script>' };
  const markup = variantDocument('Editor', props);
  assert.equal(markup.match(/<\/script>/g).length, 2);
  const [, json] = markup.match(/return \{ props: (.+) \};/);
  assert.deepEqual(JSON.parse(json), props);
});

test('covers every canvas frame and every enum prop value in the source', async () => {
  assert.deepEqual(
    Object.keys(frames)
      .map((frame) => `${frame}.dc.html`)
      .sort(),
    [...canvas.order].sort(),
  );
  for (const file of canvas.order) {
    const frame = file.replace(/\.dc\.html$/, '');
    const source = await designFile(`v4/${file}`);
    const [, metadata] = source.match(/data-props='([^']+)'/);
    const configs = Object.values(frames[frame]);
    assert.ok(configs.length > 0, frame);
    for (const [prop, { options }] of Object.entries(JSON.parse(metadata))) {
      for (const value of options ?? []) {
        assert.ok(
          configs.some(({ props }) => props?.[prop] === value),
          `${frame}: missing ${prop}=${value}`,
        );
      }
    }
  }
});
