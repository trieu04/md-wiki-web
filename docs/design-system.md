# Design system: tokens, components, layout (extracted from UI v4)

Source of truth: canvas **md-wiki-web UI v4** (https://claude.ai/artifact/Lxw6KDBmXBFPYTZRX7DzBh), copied byte-for-byte into `design/v4/*.dc.html` (version `1795377557-a5b3`, 2026-11-23). Every value below was extracted from those files; frequencies in brackets are occurrence counts across all frames. Anything **not** drawn in the frames is listed in §6 and must not be invented by an implementer.

Reference renders: `pnpm design:shots` renders every frame and variant with the canvas's own runtime (`design/runtime/support.js`) into `design/reference/<Frame>/<variant>@<width>.png`. Those PNGs are what terra compares against.

## 1. Frame index (design nodes)

| Node id | File | Route | Frame size | Variants (props / state) |
| --- | --- | --- | --- | --- |
| `F-01 Home` | `Main.dc.html` | `/` | 1440×1150 fill | state `scope`: mine \| all |
| `F-02 Search` | `Search.dc.html` | `/search?q=` | 1440×1050 fill | state `sort`: relevance \| trust \| recent; trust filter toggles |
| `F-03 Page` | `Page.dc.html` | `/wiki/*path` | 1440×1350 fill | state `sel` (section), `following`, `helped`: yes\|partly\|no, `revealed` |
| `F-04 Trust` | `Trust.dc.html` | drawer over `/wiki/*path` | 1440×1000 fill | prop `mode`: why \| check \| use \| report; state `done`, `result`, `worked`, `kind` |
| `F-05 You` | `You.dc.html` | `/me` | 1440×950 fill | state `tab`: following \| trust \| suggestions; prefs switches |
| `F-06 Editor` | `Editor.dc.html` | `/wiki/*path/edit?section=` | 1440×1100 fill | prop `baseChanged`; state `tab`: write \| preview \| diff |
| `F-07 Conflict` | `Conflict.dc.html` | `/me/suggestions/:id/resolve` | 1440×1000 fill | state `choice`: merge \| mine \| drop |
| `F-08 Inbox` | `Inbox.dc.html` | `/work` | 1440×1000 fill | state `tab`: all \| decide \| check \| spot \| mentions \| done; `sel` |
| `F-09 Proposals` | `Proposals.dc.html` | `/work/proposals` | 1440×1000 fill | state `tab`: open \| stale \| blocked \| published \| rejected \| all |
| `F-10 Review` | `Review.dc.html` | `/work/proposals/:slug` | 1440×1250 fill | prop `scenario`: escalated \| disputed \| locked \| publishing \| blocked; state `tab`, `choice` |
| `F-11 Discussions` | `Discussions.dc.html` | `/work/discussions` | 1440×1000 fill | state `filter`: open \| mine \| closed \| all; `sel` |
| `F-12 Credibility` | `Credibility.dc.html` | `/work/credibility` | 1440×1150 fill | state `tab`: queue \| coverage \| sources; `sel`, `outcome` |
| `F-13 Ops` | `Ops.dc.html` | `/work/ops` | 1440×1100 fill | — |
| `F-14 Settings` | `Settings.dc.html` | `/work/settings` | 1440×1100 fill | state `tab`: review \| trust \| people \| agents \| models \| storage |
| `C-TopBar` | `TopBar.dc.html` | shared | 1440×56 | props `active` (home\|browse\|recent\|search\|you\|workspace\|none), `query`, `role` (page author\|reader) |
| `C-WorkNav` | `WorkNav.dc.html` | shared | 220×1000 | prop `active` (inbox\|proposals\|discussions\|recheck\|mine\|ops\|settings) |

A task cites a node as `F-03 Page › <element>` (heading text or `aria-label` from the file).

## 2. Tokens

### 2.1 Colour

| Token | Hex | Use (from frames) |
| --- | --- | --- |
| `bg.canvas` | `#F6F7F9` [33] | page ground, top-bar search field |
| `bg.surface` | `#FFFFFF` [142] | cards, top bar, inputs |
| `bg.subtle` | `#FAFBFC` [1], `#F4F6FB` [1] | table head / quiet panels (see frame for exact use) |
| `bg.selected` | `#EEF2FC` [13] | selected pill/toggle background |
| `bg.nav-current` | `#EEF1F6` [3] | current nav item |
| `bg.avatar` | `#E7ECFA` [7] | avatar circle |
| `border.default` | `#E4E7EC` [63] | card borders, top-bar bottom |
| `border.control` | `#D5D9E0` [60] | buttons, pills, inputs |
| `border.input-strong` | `#C9CED8` [2] | home search input, dashed "ask" box |
| `border.divider` | `#EEF0F3` [27] | card header rule |
| `border.row` | `#F1F2F5` [17] | list/table row rule |
| `border.muted` | `#E9EBEF`, `#E9EDF5` | frame-specific; cite frame |
| `text.primary` | `#14161B` [70] | body text, headings |
| `text.body-strong` | `#2A2F38` [2], `#22252B` [2] | snippet/body copy in cards |
| `text.secondary` | `#3A404C` [48] | secondary copy |
| `text.muted` | `#545B68` [139] | meta, labels, counts |
| `text.placeholder` | `#8A909C` [11] | unchecked checkbox border, quiet text |
| `text.input-placeholder` [D-42] | `#545B68` (= `text.muted`) on the top-bar search (`canvas` background); native `#757575` elsewhere on white | frames leave input placeholders unstyled (browser default #757575 = 4.3:1 on `#F6F7F9`, fails AA); accepted pixel deviation on the top-bar search crop |
| `accent` | `#2453D6` [72] | links, primary buttons, selection, focus ring |
| `accent.hover` | `#1C42AE` [17] | `a:hover`, avatar initials |
| `accent.tint` | `#C9D3F2` [4] | accent borders on tinted surfaces |
| `trust.checked` | `#1E7F45` | icon fill; spread bar |
| `trust.checked.bg / fg / border` | `#E6F4EC` / `#11512E` / `#BFE0CC`, `#F1F9F4` | success callouts |
| `trust.reviewed` | `#7A5A00` | icon stroke/fill |
| `trust.reviewed.bar` | `#B07C00` | spread bar segment |
| `trust.reviewed.bg / fg` | `#FFF4DB` / `#5C4300` | callouts |
| `trust.none` | `#6B7280` | icon stroke |
| `trust.none.bar` | `#C5C9D1` | spread bar segment |
| `trust.recheck` | `#C25A0A` | icon fill, notification dot |
| `trust.recheck.bg / fg / border` | `#FDF1E7` / `#8A3D05`, `#5E2A03` / `#F0C9A6` | "Use with care" notes |
| `trust.error` | `#C33027` | icon fill |
| `trust.error.bg / fg / border` | `#FCEDEC` / `#7D1B16`, `#A1261F` / `#F0C2BF` | error callouts |
| `ai` | `#5B3FB8` | AI tag text |
| `ai.bg / border` | `#EDE8FA` / `#CDBFF0` | AI tag and AI cards |
| `mark` | `#FFF0B8` | search hit highlight |
| `disabled.bg / fg` | `#E4E7EC` / `#545B68` | disabled primary button (F-10 Review › Your decision) |

Implementers must open the cited frame for colours marked "frame-specific" and use the exact hex at that spot; no new colours.

### 2.2 Typography

| Token | Value |
| --- | --- |
| `font.ui` | `Inter, system-ui, sans-serif` (400, 500, 600, 700) |
| `font.content` | `'Source Serif 4', Georgia, serif` (opsz 8–60; 600, 700) — page titles, wiki body |
| `font.mono` | `'JetBrains Mono', monospace` — paths, hashes, versions |
| Base | 14px / line-height 1.5, colour `text.primary` |
| Scale (px) | 11 [15] · 12 [84] · 12.5 [2] · 13 [94] · 14 [71] · 15 [11] · 16 [8] · 17 [3] · 17.5 [1, serif body] · 18 [3] · 19 · 20 · 22 [6] · 23 · 24 [10] · 30 · 34 (Home H1 serif) · 36 |
| Weights | 400, 450 (WorkNav idle), 500, 600 (dominant), 700 |
| Overline | 11px, 600, `letter-spacing: 0.06em`, uppercase, `text.muted` (WorkNav group titles) |

Fonts: the frames load Google Fonts. **Deviation DV-1 (approved, D-17)**: self-host the same families via `@fontsource-variable/inter`, `@fontsource-variable/source-serif-4`, `@fontsource-variable/jetbrains-mono` to avoid a third-party request from an internal app. The local CSS family names have the ` Variable` suffix; Source Serif 4 includes the optical size axis.

### 2.3 Radius, spacing, size

- Radius (px): 4 (checkbox) · 6 (badge chip in search) · 7 (nav item, pill toggle) · 8 [65] (buttons, notices) · 9 (top-bar search) · 10 [40] (large input/button, count pill) · 12 [18] (cards) · 14 · 999 (chips). Avatar 17 (34px circle).
- Spacing is not on a strict scale. Values used: 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 48. Tailwind's default 4px scale covers most; the odd values (5, 7, 9, 14, 18, 22) are added as named spacing tokens so no arbitrary values appear in components.
- Content max widths: 1240 (reading screens), 1400 (workspace screens). Rails: 260–400.
- Heights: top bar min 56; top-bar search 38; home search & primary 48; icon button 40; avatar 34; count badge 20; spread bar 8.
- Shadow: only the avatar focus/current ring `0 0 0 2px #FFFFFF, 0 0 0 4px #2453D6`. No elevation shadows elsewhere (drawer: see F-04).
- Focus: `outline: 2px solid #2453D6; outline-offset: 2px` on `:focus-visible` for `a, button, input` (all frames' helmet CSS).


### 2.4 Frame-derived tokens (D-35)

Exact values that appear in a frame but were missing from §2.1–2.3 are added as named tokens when an implementation task meets them. Each row cites its frame; nothing here is approximated.

| Token | Value | Frame |
| --- | --- | --- |
| `size.icon-badge-sm` | 13px | F-03 page header badge |
| `space.mark-x` | 1px (horizontal padding of search highlight) | F-02 result snippet |
| `radius.mark` | 2px | F-02 result snippet |
| `space.9` | 9px | F-03 section badge horizontal padding |
| `size.spread-sm-width` / `size.spread-sm` / `radius.spread-sm` | 120px / 6px / 3px | F-03 page header spread bar |
| `leading.control` | `normal` | F-01 scope pills, F-02 sort pills, F-03 section badge/link-style button, F-10 decision/secondary buttons, C-TopBar count badge |
| `text.native-button` | `#000000` (native `ButtonText` in the light reference render) | F-10 secondary buttons |

## 3. Trust label system (exact, from every frame's `TL` table)

| Label | SVG (viewBox 0 0 12 12) path 1 | fill / stroke | path 2 | fill / stroke |
| --- | --- | --- | --- | --- |
| Checked against source | `M.5 6a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0` | `#1E7F45` / none | `M3.5 6.2 5.2 7.8 8.5 4.4` | none / `#FFFFFF` |
| Reviewed | `M1 6a5 5 0 1 0 10 0a5 5 0 1 0-10 0` | none / `#7A5A00` | `M6 1a5 5 0 0 1 0 10z` | `#7A5A00` / none |
| Not reviewed | `M1.25 6a4.75 4.75 0 1 0 9.5 0a4.75 4.75 0 1 0-9.5 0` | none / `#6B7280` | — | — |
| Under re-check | `M6 .8 11.4 10.8H.6z` | `#C25A0A` / none | `M6 4.6v2.8M6 8.6v.5` | none / `#FFFFFF` |
| Confirmed error | `M4 .8h4L11.2 4v4L8 11.2H4L.8 8V4z` | `#C33027` / none | `M4.3 4.3l3.4 3.4M7.7 4.3 4.3 7.7` | none / `#FFFFFF` |

Stroke width 1.5 at 12/14px, 1.3 at 18px; path 2 `stroke-linecap: round`. Sizes used: 12, 14, 18. Status is always icon + words; never colour alone.

## 4. Component inventory

Each component lives in `apps/web/src/ui/<Name>.tsx`, takes only presentational props, and appears in the dev gallery (`/__gallery`) with every variant listed here.

| Component | Variants / states drawn | Source nodes |
| --- | --- | --- |
| `TrustIcon` | 5 labels × sizes 12/14/18 | all frames |
| `TrustBadge` | inline (icon+label, table cell); bordered link (search result, `aria-label` "… Why this label"); section-heading button (F-03) | F-01, F-02, F-03 |
| `SpreadBar` | segmented bar, gap 2, `role="img"` + aria-label; with caption line. Sizes (D-35, from the frames): `md` 8px high, radius 4, full width (F-01 labels card); `sm` 120×6px, radius 3 (F-03 header) | F-01 labels card, F-03 header |
| `TopBar` | `active` × 7, `role` reader (no Workspace) / page author, notification dot, avatar ring when `you` | C-TopBar |
| `WorkNav` | `active` × 7; strong count badge vs plain count; footer status | C-WorkNav |
| `Button` | primary (accent fill, 48px home / 10px-16px padding decision), secondary (white + `border.control`), disabled primary (§2.1), link-style button | F-01, F-10, F-03 |
| `PillToggle` group | `aria-pressed` on/off (`bg.selected` + accent border vs white + control border) | F-01 Recently updated, F-02 Sort |
| `Chip` | link chip radius 999 | F-01 Often searched |
| `Card` | white, 1px `border.default`, radius 12; header row 14×18 padding with `border.divider` | all |
| `Tabs` | `role="tablist"` with counts | F-05, F-06, F-08, F-09, F-10, F-12, F-14 |
| `Checkbox` | custom 16px, radius 4, checked (accent fill, white tick) / unchecked (`#8A909C` border) | F-02 Trust filter |
| `RadioCards` | `role="radio"` option cards | F-04, F-07, F-10, F-12 |
| `Switch` | `role="switch"` on/off | F-05 Tell me when |
| `SearchInput` | top bar (38px, `bg.canvas`, ⌘K hint), home (48px, white, strong border) | C-TopBar, F-01 |
| `TextInput`, `Textarea`, `Select`, native radio | as drawn in F-02 filters, F-04 forms, F-05, F-10 | |
| `Table` | 12px muted 600 head, row rule `border.row`, scroll box `overflow-x: auto` with min-width | F-01, F-05, F-09, F-10, F-12, F-13 |
| `Callout` | recheck warn, error, success, info/accent, AI — [D-37] info/accent = white bg, 1px `accent.tint` border, r10, padding 16/18 (F-10 *Your decision*, Editor *After you submit*); AI = white bg, 1px `border.default` (#E4E7EC), r10, padding 16/18 with an `AITag` in the heading (F-10 *Agent review*) — no `ai.bg` fill | F-02, F-03, F-04, F-10 |
| `AITag` | small "AI" tag (`ai` colours) | F-06, F-08, F-10, F-12 |
| `CountBadge` | dark pill (`#14161B` bg, white, 20px) | C-TopBar, C-WorkNav |
| `Mono` | JetBrains Mono inline text | F-07, F-10, F-13, F-14 |
| `Mark` | search highlight | F-02 |
| `Drawer` | right drawer `role="dialog"` with tabs and close — [D-37] opens/closes instantly, no animation; [D-39] non-modal side panel as drawn (`aria-modal="false"`, no scrim, page stays interactive, **no focus trap**): on open focus moves to the drawer heading/first control, Esc and the close button close it, focus returns to the trigger | F-04 |
| `DiffView` | line diff with flagged phrase, inline | F-06 Changes, F-10 Changes (CodeMirror merge) |
| `MarkdownToolbar` | B, I, H, [ ], ¹, ⊞ buttons with aria-labels | F-06 |
| `PublishProgress` | phase steps | F-10 scenario publishing/blocked |
| Layouts | `ReadingLayout` (TopBar + `max-width 1240` main, content `flex 999 1 560px` + aside `flex 1 1 320px max 400px`, wrap); `WorkspaceLayout` (TopBar + WorkNav 220 + content max 1400, wrap) | F-01, F-08 |

## 5. Layout and breakpoint rules

The frames contain **no media queries**. Responsiveness is intrinsic: rows are `flex-wrap: wrap`, main columns `flex: 999 1 560px; min-width: 0`, side columns `flex: 1 1 <basis>` with a max width, tables scroll inside an `overflow-x: auto` box with a `min-width`. The implementation must reproduce exactly these flex rules (not introduce breakpoints), so the app reflows the same way the reference renderer does.

Verification widths: **390, 768, 1024, 1440** (phone, tablet, small laptop, frame width). The reference renderer produces the expected image at each width from the same frame.

## 6. Not designed — must not be invented (see Q-UI-* in the plan)

1. Hover for buttons, pills, rows, nav items (only `a:hover` colour is drawn). Pressed/active states.
2. Loading states (skeletons/spinners) on any screen.
3. Empty states, other than copy in ux.md (Home nothing followed, no search results, no attestations, empty Inbox).
4. Error states for API failures, form field errors, toasts.
5. Phone top bar: ux.md says nav collapses into a menu and search becomes an icon; the frame just wraps. **[D-43]** Until a menu is designed, the TopBar reproduces the frame's intrinsic wrapping at 390/768 (no collapsing menu, no search icon).
6. Dark theme values (ux.md says tokens support it; no values drawn).
7. Screens: Login, Page History, Browse (top-bar "Browse" links to F-03), Notifications (bell), ⌘K search palette, Review tabs *Final page*, *Current page*, *Discussion* (drawn as placeholder text only), Import `.contribution.md` dialog, Assign dialog, Audit log, AI jobs page, 404/403 pages.
8. Reference-renderer quirk: inside full frames the imported TopBar renders at its intrinsic width (≈976px) instead of stretching; the TopBar is judged against its own frame `C-TopBar` at full width, and frame comparisons mask the top 56px band.

### 6.1 States addendum — APPROVED (D-14, 2026-11-23)

Derived only from existing tokens. Undesigned screens follow D-16 in implementation-plan.md §6.1.

| State | Proposal |
| --- | --- |
| Hover: primary button | background `accent.hover` `#1C42AE` (same pair already used for links) |
| Hover: secondary button / pill / nav item / row link | background `bg.nav-current` `#EEF1F6` |
| Pressed | same as hover; no transform |
| Disabled (any button) | `disabled.bg/fg` as drawn in F-10, `cursor: not-allowed`; inputs: `bg.canvas` + `text.muted` |
| Focus | as drawn: 2px accent outline, offset 2 |
| Loading (lists/cards) | the card frame renders with its header; body shows rows of `border.row`-coloured 12px bars (no shimmer animation); buttons show their label with `aria-busy` and are disabled |
| Empty | neutral sentence in `text.muted` 13px inside the card body, using ux.md copy where it exists |
| Error (query failed) | info callout using `trust.error.bg/fg/border` with the error copy and a *Try again* secondary button; form field errors: 12px `trust.error.fg` text under the field + `aria-invalid` + `aria-describedby` |
