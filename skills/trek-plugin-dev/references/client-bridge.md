# Client bridge — sandboxed iframe and postMessage protocol

Only `page` and `widget` plugins have a client. It is a **pre-built static
bundle** in `client/` (entry `client/index.html`) — no build step at install
time.

## The sandbox

- Served same-origin from `/plugin-frame/<id>/…` but with an iframe sandbox
  **without `allow-same-origin`** → the frame runs at an **opaque origin**: no
  cookies, no session, no parent DOM access, no popups.
- Because the origin is opaque, every `postMessage` to the parent must use
  target origin `'*'` — there is no nameable origin to pin.
- Per-plugin CSP (verbatim from the server's `plugin-frame.controller.ts`):
  `default-src 'none'` · `script-src 'self' 'unsafe-inline'` ·
  `style-src 'self' 'unsafe-inline'` · `img-src 'self' data: blob:` ·
  `font-src 'self' data:` · `connect-src 'self' https://<each granted host>` ·
  `frame-ancestors 'self'` · `base-uri 'none'` · `form-action 'self'` ·
  `sandbox allow-scripts allow-forms`. `connect-src` hosts come from the granted
  `http:outbound:<host>` permissions (see the egress trap in
  [manifest.md](manifest.md)). What this means for images/fonts is subtle and
  **not** "everything is blocked" — see
  [What the CSP blocks](#what-the-csp-blocks--images-and-fonts).
- Height: widgets/pages request size via `trek:resize` (capped at 2000 px).

## Protocol

Announce readiness, receive context, then invoke your own server routes
through TREK (which attaches the user's session server-side):

```js
// 1. Announce — TREK replies with trek:context
window.parent.postMessage({ type: 'trek:ready' }, '*')

window.addEventListener('message', (e) => {
  const m = e.data
  if (m.type === 'trek:context') {
    // m.tripId, m.userId (string|null), m.theme ('light'|'dark'),
    // m.locale, m.hostOrigin
    render(m)
  }
  if (m.type === 'trek:response' && m.requestId === '1') { use(m.data) }
  if (m.type === 'trek:error'    && m.requestId === '1') { fail(m.code, m.message) }
})

// 2. Call one of your OWN server routes — proxied with the user's session:
window.parent.postMessage(
  { type: 'trek:invoke', requestId: '1', sub: '/status', method: 'GET' }, '*')
```

### Messages you send to TREK (inbound bridge)

| Message | Payload | Effect |
|---|---|---|
| `trek:ready` | — | TREK replies with `trek:context` |
| `trek:context:request` | — | Re-request the context |
| `trek:navigate` | `{ to }` | In-app navigation to an **app-absolute path** (must start with `/`, query string allowed; protocol-relative `//…` is rejected) — it is **not** limited to relative paths |
| `trek:notify` | `{ level, message }` | Toast; `level` = `info` \| `success` \| `warning` \| `error` |
| `trek:resize` | `{ height }` | Set iframe height (capped at 2000 px) |
| `trek:invoke` | `{ requestId, sub, method, body }` | Call your own route (`sub` is the path below `/api/plugins/<id>`, query string allowed); resolves as `trek:response` or `trek:error` |

### Messages TREK sends you (host bridge)

| Message | Payload |
|---|---|
| `trek:context` | `{ tripId, userId, theme, locale, hostOrigin }`. `tripId` is a **`string \| null`** — **`null` for every `page` plugin** and for a widget with no spotlighted trip; don't assume it's present. `userId` is a **string or `null`**. `theme` (`'light'`/`'dark'`) is sent by TREK 3.2.x, and **re-sent live when the user toggles in-app dark mode on ≥ 3.2.1** — so handle **repeated** `trek:context`, not just the first. See [Making the UI feel native](#making-the-ui-feel-native). |
| `trek:response` | `{ requestId, data }` — successful `trek:invoke` |
| `trek:error` | `{ requestId, code, message }` — failed `trek:invoke`; `code` is the HTTP status or `"error"` |

## Practical notes

- Correlate every `trek:invoke` with a unique `requestId`; responses arrive
  asynchronously and out of order.
- Query parameters go inside `sub` (e.g. `sub: '/state?tripId=' + ctx.tripId`
  — this is exactly what the koffi example does).
- Re-apply `m.theme` on **every** `trek:context` (≥ 3.2.1 re-sends it on the
  in-app dark toggle), and respect `prefers-reduced-motion` for animation.
- **Your plugin's own `ctx.ws.broadcast*` events never arrive here.** The bridge
  only ever sends `trek:context`/`trek:response`/`trek:error`; TREK does not
  forward `plugin:<id>:*` WS events into the frame. To reflect live server state,
  **poll your own route via `trek:invoke`** on an interval. See
  [server-api.md](server-api.md).
- Secrets (`secret: true` settings) are **never** delivered to the iframe —
  fetch derived data through your own server route instead.
- Widget slots: `sidebar` renders as a dashboard card, `hero` as a
  boarding-pass-bar overlay (TREK >= 3.2.0). Set in
  `capabilities.widget.slot`.

Reference implementation: `plugin-sdk/examples/koffi/client/index.html`
(single self-contained HTML file: `trek:ready` → `trek:context` →
`trek:invoke` with pending-request map).

## What the CSP blocks — images and fonts

The frame runs at an **opaque origin** (sandbox without `allow-same-origin`),
and the server comments on its own CSP: *"`'self'` matches nothing — inline is
the only way its own script can run."* That single fact — not a fallback to
`default-src 'none'` — decides what renders. `img-src` and `font-src` *are*
granted, but only `data:`/`blob:` within them are usable, because `'self'` is
void at the opaque origin:

| You write | Renders? | Why |
|---|---|---|
| Inline `<script>` / inline `<style>` | ✅ | `'unsafe-inline'` is granted |
| Inline SVG (`<svg><path>…`) | ✅ | Markup, not an `img-src` fetch |
| `<img src="data:image/png;base64,…">` | ✅ | `img-src` includes `data:` |
| `<img>` / canvas from a `blob:` URL | ✅ | `img-src` includes `blob:` |
| `<img src="./logo.png">` (a file in your `client/` bundle) | ❌ | Relative → resolves against the opaque origin, which `'self'` does **not** match |
| `<img src="https://cdn…/x.png">` | ❌ | No `https` host in `img-src` |
| `<image href="./x.png">` inside inline SVG | ❌ | Same `img-src` rule as `<img>` |
| CSS `background-image: url(./x.png)` | ❌ | Same `img-src` rule (a `data:`/`blob:` url would pass) |
| `@font-face` from a bundled `.woff2` or Google Fonts | ❌ | `font-src` is `'self' data:` — `'self'` is void, no host allowed |
| `@font-face` from a `data:` URL | ✅ | `font-src` includes `data:` |

Consequences:

* You **cannot** reference a bundled file by path (`./logo.png`, `client/x.svg`)
  or any external URL for images/fonts — the opaque origin voids `'self'` and no
  host is allow-listed. This is why the koffi mascot is **hand-built inline
  SVG**, not a bundled PNG. (Inline `<svg>` vector artwork is **confirmed to
  render** in a live instance — keep using it for icons/mascots, and re-draw any
  raster a designer hands you as vector.)
* To show a raster, inline it as a **`data:` (or `blob:`) URI** — those are the
  only image sources that work. For logos/mascots/icons prefer real inline
  **vector SVG**: no encoding, scales cleanly, themeable via `currentColor`.
* No web fonts (bundled or Google) — you get the **system font stack**. Don't
  load Poppins (TREK's own font); style with `system-ui`/`-apple-system`.
* No favicons, no icon fonts. Use inline SVG icons.

> **Dev-server caveat:** `trek-plugin dev` serves `/ui` with **no CSP and no
> sandbox**, so a bundled `./logo.png` or a Google font *works in dev and then
> fails in the real host*. Verify image/font choices against the real CSP (or a
> harness that applies it), not just `dev`. See [testing.md](testing.md).

## Making the UI feel native

The frame inherits **none** of TREK's styling — not its stylesheet, theme class,
or fonts. To look built-in rather than bolted-on, reproduce TREK's design
language and drive it off `trek:context`.

### 1. Mirror TREK's design tokens

TREK's tokens live in `client/src/index.css` (`:root` = light, `.dark` = dark).
Copy the ones you use into your own `:root` + a dark override. Real current
values (verify against the source — they can drift):

| Token | Light | Dark |
|---|---|---|
| `--bg-card` | `#ffffff` | `#131316` |
| `--bg-primary` | `#ffffff` | `#121215` |
| `--bg-hover` | `rgba(0,0,0,0.03)` | `rgba(255,255,255,0.06)` |
| `--text-primary` | `#111827` | `#f4f4f5` |
| `--text-secondary` | `#374151` | `#d4d4d8` |
| `--text-muted` | `#6b7280` | `#a1a1aa` |
| `--text-faint` | `#9ca3af` | `#71717a` |
| `--border-faint` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.07)` |
| `--accent` | `#111827` | `#e4e4e7` |
| `--accent-text` | `#ffffff` | `#09090b` |
| `--accent-hover` | `#1f2937` | `#d4d4d8` |
| `--success` | `#16a34a` | `#22c55e` |
| `--danger` | `#dc2626` | `#ef4444` |

Radius scale: `--radius-sm 8px`, `--radius-md 12px`, `--radius-lg 16px`,
`--radius-xl 20px`. Card shadow (`--shadow-card`, light):
`0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04)`. TREK's font is Poppins
(`--font-system`), but **web fonts are CSP-blocked** (see above) so you get the
system fallback — style with `system-ui, -apple-system, 'Segoe UI', sans-serif`
and don't load Poppins.

### 2. Switch light/dark from context (with a pre-context default)

Apply the theme to **`document.documentElement` (`:root`), not `<body>`, and set
CSS `color-scheme` per theme**. The iframe's canvas backdrop follows the **root
element's `color-scheme`** — if it stays at the default (light) while you render
dark-theme content on a transparent body (as a flush sidebar widget must), the
browser paints an **opaque white canvas** behind your widget and light text lands
on white. TREK itself does the same (`.dark { color-scheme: dark }` in
`index.css`). Observed in a Chromium harness; engine-level behavior, so expect it
in the real frame too.

```css
:root { color-scheme: light; --bg-card:#fff; --text-primary:#111827; /* …light… */ }
:root[data-theme="dark"] { color-scheme: dark; --bg-card:#131316; --text-primary:#f4f4f5; /* …dark… */ }
/* before trek:context arrives, follow the OS preference */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { color-scheme: dark; --bg-card:#131316; --text-primary:#f4f4f5; /* …dark… */ }
}
```
```js
function resolveTheme(m) {
  var t = m && typeof m.theme === 'string' ? m.theme.trim().toLowerCase() : ''
  if (t === 'dark' || t === 'light') return t          // host told us
  // Pre-3.2.0 hosts may omit theme — fall back to the OS scheme
  return window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
// on every trek:context:
document.documentElement.dataset.theme = resolveTheme(m)
```

(For `hero` widgets the host forces `color-scheme: light` on the frame element
anyway — another reason hero artwork should not depend on a dark canvas.)

> **Theme across versions:** TREK **3.2.x sends** `theme` in `trek:context`
> (derived from its `<html>.dark` class, `PluginFrame.tsx`). **≥ 3.2.1** also
> installs a `MutationObserver` on that class and **re-posts the same
> `trek:context`** when the user flips the in-app dark toggle, so a widget that
> re-applies theme on *every* `trek:context` restyles instantly — **handle
> repeated context messages, not just the first.** On **≤ 3.2.0** the host sends
> context once and does **not** follow the in-app toggle (and older builds may
> omit `theme` entirely), so the frame only tracks the OS scheme via your
> `prefers-color-scheme` fallback / a `matchMedia('change')` listener until it
> re-requests context. The defensive `resolveTheme` above is correct for all
> versions; a real `m.theme` always wins.

### 3. Localize off `m.locale`

`trek:context` carries `locale`. Key your copy off it, English as fallback:

```js
const L = (m.locale || '').toLowerCase().startsWith('de') ? STR.de : STR.en
```

### 4. House style

- **No emoji in the UI** — TREK's own interface is emoji-free. Use inline SVG
  icons/marks and plain text so the plugin matches the host.
- `--text-muted` for small uppercase kicker labels,
  `font-variant-numeric: tabular-nums` for counts.
- **Buttons — TREK's exact spec** (from `index.css` + real components):
  - Primary: `background:var(--accent); color:var(--accent-text);
    border:none; border-radius:8px` (`--radius-sm`); `padding:6px 16px`;
    `font-size:12px; font-weight:600`.
  - Secondary: same geometry, `background:none;
    border:1px solid var(--border-primary)` (padding `6px 14px`).
  - **Press feedback (TREK's signature feel — don't invent your own):**
    ```css
    button:not(:disabled) {
      transition-property: transform, color, background-color, border-color,
                           box-shadow, opacity, filter;
      transition-duration: 180ms;
      transition-timing-function: cubic-bezier(0.23, 1, 0.32, 1);
    }
    button:not(:disabled):active { transform: scale(0.97); transition-duration: 80ms; }
    ```
    Scale-press, not `translateY`. Guard with `prefers-reduced-motion`.
- Call `trek:resize` after every render/content change so the card fits exactly.
- Respect `prefers-reduced-motion` for any animation (koffi does).

### 5. Don't draw your own card, and fit the fixed height — `sidebar` vs `page`

A `sidebar` widget renders **inside TREK's own titled card**: the host wraps your
frame in `<div class="bg-surface-card border border-edge rounded-xl
overflow-hidden">` with a header showing your plugin's name, and puts the frame
in a **fixed-height 180px box** (`PluginWidgets.tsx`, confirmed in a live
instance). Two consequences:

- **Don't draw card chrome.** A background, `border`, `border-radius`, or
  `box-shadow` on your root produces a visible **card-in-card** (doubled borders,
  mismatched top corners). Render **transparent and flush**; use the tokens for
  **text and controls**, keep the **container** bare. A full-bleed accent bar at
  the very top edge is fine — the card's `overflow-hidden` clips it to the
  rounded corners. **Because the widget is transparent, pin `color-scheme` on
  `:root` per theme** (§2) — otherwise the frame paints an opaque light canvas
  behind your dark-theme content.
- **Build for ~180px — `trek:resize` will NOT grow a sidebar widget.** The slot
  height is hard-coded and `overflow-hidden`, so content past ~180px (a footer
  row, a reset button) is **permanently clipped**, in every version. The
  `capabilities.widget.defaultSize` you declare does not change this. Put only
  essentials above the fold and drop nice-to-haves; if the UI is inherently tall,
  ship a **`page`** plugin instead.

A `page` plugin is the **opposite**: it renders in a full-page shell with **no**
host card (`PluginPage.tsx` → `PageShell` + a `w-full h-full` frame), so you own
the whole surface, draw your own layout, and here `trek:resize` **does** drive
the iframe height — report it on every layout change (e.g. via `ResizeObserver`,
capped at 2000 px):

```js
var lastH = -1
function reportHeight(root) {
  var h = Math.ceil(root.getBoundingClientRect().height) + 2
  if (h !== lastH) { lastH = h; parent.postMessage({ type: 'trek:resize', height: h }, '*') }
}
if (window.ResizeObserver) new ResizeObserver(() => reportHeight(root)).observe(root)
```

A `hero` widget is far more constrained than the sidebar. It renders as a
**fixed ~110px tall, `overflow:hidden`, `pointer-events:none`** transparent strip
sitting directly on top of the boarding pass (`DashboardPage.tsx` +
`.hero-pass-overlay` in `dashboard.css`). Consequences:

- **Display-only — it cannot receive clicks or any pointer input** (`pointer-events:none`).
- **`trek:resize` is ignored** — the frame is locked to the 110px strip
  (`height:100% !important`); content past ~110px is clipped.
- **Desktop-only** — hero widgets do **not** render on mobile, and only when the
  dashboard is showing a boarding-pass hero trip.
- `color-scheme:light` is forced on the hero frame.

So build a short, wide, **non-interactive** visual (like the koffi mascot), not a
control surface. Need interactivity or height? Use a `sidebar` widget or a
`page`.
