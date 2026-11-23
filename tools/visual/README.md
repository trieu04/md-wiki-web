# App visual comparisons

Run `pnpm visual:shots --task <ID> --config <cases.mjs>` from the repo root. References must already exist (`pnpm design:shots`). The config is local, trusted JavaScript and default-exports one entry for each app state the task implements:

```js
export default [
  {
    frame: 'Search',
    variant: 'recent',
    path: '/search?q=pinhole%20size',
    ready: 'button[aria-pressed="true"]:has-text("Newest")',
    async prepare(page) {
      await page.getByRole('button', { name: 'Newest', exact: true }).click();
    },
  },
];
```

This example is for the Search implementation task; the current starter app does not implement that screen. Choose `frame` and `variant` from the reference manifest. `ready` must identify the rendered final state (not a loading placeholder). Use `prepare(page, { width, height })` for real app interactions when the URL does not select the state. Each case uses a fresh browser context and runs at 390, 768, 1024, and 1440px, with the reference board's viewport height.

The runner builds the actual React app in Vite's `visual` mode into a temporary directory and opens `vite preview` on loopback. It waits for MSW before running `prepare` and resets window and nested scroll before capture. `apps/web/src/dev/fixtures/samples.ts` copies the reference `renderVals` sample data; MSW serves it at `/__visual/fixtures/<Frame>` for visual tooling. The Search fixture matches the `/search` response (`35` sections across `14` pages, with five displayed hits); verbatim frame captions are kept in `searchFrame`. For screens that load from the public API, register typed MSW handlers in `apps/web/src/dev/fixtures/browser.ts` when their DTOs and bindings exist. Unmocked API requests fail instead of going to a live backend. Normal builds do not include the worker or fixtures.

Open `visual/report/<ID>/index.html` for original-size reference, actual, and diff PNGs. The TopBar's first 56px are excluded only for full frames, not for standalone TopBar or WorkNav. Image dimensions that differ count as mismatches outside the overlap (excluding the mask). Mismatch percentages are diagnostic; there is no implicit pass/fail threshold for a screen.

Run `pnpm visual:shots --self-test` to exercise preview and MSW without a completed screen. This reports a real reference compared against itself (0%) and a separate preview probe with a 1px-shifted element (40 pixels detected), at `visual/report/P0-09/index.html`.
