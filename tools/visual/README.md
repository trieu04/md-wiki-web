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

Choose `frame` and `variant` from the reference manifest. `ready` must identify the rendered final state (not a loading placeholder). Use `prepare(page, { width, height })` for real app interactions when the URL does not select the state. Each case uses a fresh browser context and runs at 390, 768, 1024, and 1440px, with the reference board's viewport height.

The runner builds the actual React app in Vite's `visual` mode into a temporary directory and opens `vite preview` on loopback. It waits for MSW before running `prepare` and resets window and nested scroll before capture. `apps/web/src/dev/fixtures/samples.ts` copies the reference `renderVals` sample data; MSW serves it at `/__visual/fixtures/<Frame>` for visual tooling. The Search fixture matches the `/search` response (`35` sections across `14` pages, with five displayed hits); verbatim frame captions are kept in `searchFrame`. For screens that load from the public API, register typed MSW handlers in `apps/web/src/dev/fixtures/browser.ts` when their DTOs and bindings exist. Unmocked API requests fail instead of going to a live backend. Normal builds do not include the worker or fixtures.

Open `visual/report/<ID>/index.html` for original-size reference, actual, and diff PNGs. The TopBar's first 56px are excluded only for full frames, not for standalone TopBar or WorkNav. Image dimensions that differ count as mismatches outside the overlap (excluding the mask). Mismatch percentages are diagnostic; there is no implicit pass/fail threshold for a screen.

## Home and Search (P3-B)

`pnpm visual:shots --task P3-B --gallery` includes the implemented full-screen states before the gallery crops. To run only those screens, use `pnpm visual:shots --task P3-B --config tools/visual/p3-b.mjs`. The cases exercise the real Search sorting and trust controls, and set the clock for the Home fixture's relative dates.

The original frame PNGs and gallery crops are unchanged. `pnpm design:shots` also captures Phase 3 projections and stores their checksums and mask geometry in the manifest. The projections omit Home's _Often searched_, _On pages you use_, and _Start here_ blocks before layout. Rectangular masks cover the _Pages you use_ toggle, Recent section sublines and the _What changed_ header/cells, and _How trust is decided_. Search masks the trust drawer links, _Ask a question_ action, and just the deferred meta suffixes (_written in …_, _used by …_). Image-space differences caused by the remaining layout reflow and the reference TopBar's intrinsic height are intentionally not masked beyond the required top 56px.

## Phase 3 reading view (P3-C)

`pnpm visual:shots --task P3-C --gallery` adds full-screen F-03 comparisons for
its initial state and four other section selections. Use the `Page/*-reading`
references; the renderer omits deferred regions before layout and keeps the
original F-03 screenshots for later phases. The report gives both the usual
56px-mask score and the content score after cropping each image below its
measured TopBar. The shorter content viewport is padded with canvas only to
normalize viewport height; differences in overflow still count. Full original
screenshots are linked. The same report includes History captures at all four
widths for D-16 review (no pixel score).

## Component gallery (D-32/D-35)

After building the domain workspace (`pnpm --filter @md-wiki/domain build`), run
`pnpm design:shots` and `pnpm visual:shots --task P2-A --gallery`. The latter compares
`/__gallery` examples against `design/reference/crops/` at 390, 768, 1024 and 1440px,
without a TopBar mask. Open `visual/report/P2-A/index.html` for the pixel diffs.

Crops are declared in `tools/design-ref/variants.json` under `crops` as
`"Component/variant": { "frame": ..., "variant": ..., "selector": ... }`.
Selectors must resolve to one rendered element. A gallery crop defaults to the
first child of the matching `data-gallery` wrapper; `gallery` and `part` can
select a different wrapper or descendant (such as a SpreadBar caption). Set
`fit: true` for stretch-to-parent elements, or `fit: "parent"` to reproduce the
available width of a wrapping row. Only the gallery host is sized; the element
itself lays out naturally. The reference renderer publishes the full frames and
crops atomically, with separate checksum manifests.

Layout crops can use `structure: [firstColumn, secondColumn]`. The two selectors
are relative to the crop in both the reference and the gallery. These probes
hide the screen content and paint each column a distinct color. Reference
heights substitute for the unimplemented screen content; widths, placement and
wrapping remain intrinsic. The F-01 and F-08 structure crops start below the
TopBar, so no additional 56px mask is needed on those crops.

Use `/__gallery` in the dev server for Tokens and examples under
**Not in frames (§6.1)**. Review their hover, pressed, disabled and busy states
against §6.1, not a reference crop. Only drawn states get pixel comparisons.

Run `pnpm visual:shots --self-test` to exercise preview and MSW without a completed screen. This reports a real reference compared against itself (0%) and a separate preview probe with a 1px-shifted element (40 pixels detected), at `visual/report/P0-09/index.html`.
