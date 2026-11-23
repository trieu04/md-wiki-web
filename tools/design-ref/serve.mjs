import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { URL } from 'node:url';

const html = 'text/html; charset=utf-8';
const js = 'text/javascript; charset=utf-8';

const escapeAttribute = (value) =>
  String(value).replace(
    /[&"<>]/g,
    (char) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char],
  );

export function variantDocument(frame, props) {
  // dc-props passes the JSON object without stringifying its individual values.
  const values = JSON.stringify(props).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<dc-import name="${escapeAttribute(frame)}" dc-props="{{ props }}"></dc-import>
</x-dc>
<script type="text/x-dc" data-dc-script>
class Component extends DCLogic {
  renderVals() { return { props: ${values} }; }
}
</script>
</body>
</html>`;
}

export async function serve(frames, runtime) {
  const routes = new Map([['/support.js', [js, runtime]]]);
  const pages = new Map();
  for (const [frame, variants] of Object.entries(frames)) {
    const original = `/${frame}.dc.html`;
    routes.set(original, [
      html,
      await readFile(new URL(`../../design/v4${original}`, import.meta.url)),
    ]);
    for (const [variant, { props }] of Object.entries(variants)) {
      // Keep wrappers next to the frames: support.js resolves imports as siblings.
      const path = props ? `/variant-${frame}-${variant}.dc.html` : original;
      if (props) routes.set(path, [html, variantDocument(frame, props)]);
      pages.set(`${frame}/${variant}`, path);
    }
  }
  const server = createServer((request, response) => {
    const path = request.url.split('?')[0];
    const route = routes.get(path);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    } else if (path === '/favicon.ico') {
      response.writeHead(204).end();
    } else if (route) {
      response.writeHead(200, { 'Content-Type': route[0] }).end(route[1]);
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    pages,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
