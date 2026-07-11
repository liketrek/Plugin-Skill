# Client bridge — sandboxed iframe and postMessage protocol

`page`, `widget`, and **`trip-page` (≥3.2.1)** plugins have a client — a
**pre-built static bundle** in `client/` (entry `client/index.html`), no build
step at install time.

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
| `trek:notify` | `{ level, message }`; **≥3.2.2** also an optional `duration` (ms, host-clamped to ~1500–15000) | Toast; `level` = `info` \| `success` \| `warning` \| `error`. On ≤3.2.1 `duration` is ignored (host default timeout) |
| `trek:resize` | `{ height }` | Set iframe height (capped at 2000 px) |
| `trek:invoke` | `{ requestId, sub, method, body }` | Call your own route (`sub` is the path below `/api/plugins/<id>`, query string allowed); resolves as `trek:response` or `trek:error` |
| `trek:openExternal` **(host ≥3.2.2)** | `{ url }` | Ask the host to open an `http`/`https` URL in a new browser tab (the sandbox has no `allow-popups`). **≤3.2.1 hosts silently ignore it** (links "do nothing") — always use the fallback chain in [Opening external links](#opening-external-links-trekopenexternal) |
| `trek:confirm` **(host ≥3.2.2)** | `{ requestId, title?, message, confirmLabel?, cancelLabel?, danger? }` (host-truncated: title ≤120, message ≤500, labels ≤40) | Ask the host to render a **native** confirm dialog (one at a time). The shown title is always `"<pluginName> — <title>"` (just the plugin name if no title), so a plugin can't spoof a TREK system dialog. ⚠️ **`danger` defaults to TRUE** (`danger: msg.danger !== false`) — an unspecified confirm renders **destructive/red**; pass `danger:false` for a neutral one. Host answers with `trek:confirm:result` (correlate by `requestId`). **≤3.2.1: no reply ever comes** — pair with a timeout or an in-frame fallback dialog |

### Messages TREK sends you (host bridge)

| Message | Payload |
|---|---|
| `trek:context` | **3.2.0:** `{ tripId, userId, theme, locale, hostOrigin }`. **≥3.2.1 also sends** `user` (`{name, avatar, isAdmin}` or `null` — never email), `formats` (`{locale, currency, timeFormat, distanceUnit, temperatureUnit, timezone}`), `tokens` (the global palette for the current theme — see §1), and `appearance` (`{scheme, density, reducedMotion, noTransparency}`). `tripId` is **`string \| null`** — `null` for a `page` plugin and a widget with no spotlighted trip, but **set for a `trip-page` tab and a `place-detail` widget** (≥3.2.1). **≥3.2.1 also adds `placeId`** (`string \| null`): the place in view for a `place-detail` widget, else `null`. **≥3.3.0 also adds `dayId` and `reservationId`** (`string \| null`) alongside `placeId` — each set only for its own scoped slot (`day-detail` → `dayId`, `reservation-detail` → `reservationId`), else `null`. **≥3.2.2 also adds `dir`** (`'ltr' \| 'rtl'`) for the current locale's writing direction; the kit sets `lang` + `dir` on `<html>` from it, so kit-styled UI is RTL-correct for free (hand-rolled UIs should mirror it themselves). `userId` is a string or `null`. `theme` is `'light'`/`'dark'`. **Re-sent live** on any theme/appearance change (≥3.2.1 watches accent/density/high-contrast/reduced-motion too) — handle **repeated** `trek:context`, not just the first. See [Making the UI feel native](#making-the-ui-feel-native). |
| `trek:response` | `{ requestId, data }` — successful `trek:invoke` |
| `trek:error` | `{ requestId, code, message }` — failed `trek:invoke`; `code` is the HTTP status or `"error"` |
| `trek:confirm:result` **(host ≥3.2.2)** | `{ requestId, confirmed }` — reply to your `trek:confirm` |
| `trek:event` **(host ≥3.2.2)** | `{ event, tripId }` — live push of a trip event into the frame for the trip in view: **core events** (`place:created`, `day:updated`, …) **and your own `plugin:<id>:*` broadcasts**. Carries **only** the event name + `tripId`, never the payload — fetch details via `trek:invoke`. This is the **client-side counterpart of the server `events` surface**, and the first path that lets your own `ctx.ws.broadcast*` reach your iframe (≤3.2.1 it never arrived — see [server-api.md](server-api.md)). Still treat it as an accelerator on top of polling; ≤3.2.1 hosts never send it |

> **`openExternal`/`confirm`/`onEvent` need BOTH a new host AND a new kit.** Two
> independent version floors:
> - **Host side (TREK ≥ 3.2.2):** the host must *handle* `trek:openExternal` /
>   `trek:confirm` and *send* `trek:event` / `trek:confirm:result`. On ≤3.2.1
>   these messages are ignored — the wire calls are inert no matter what SDK you
>   built with.
> - **Client side (SDK ≥ 1.4.0):** the kit helpers `trek.openExternal(url)`,
>   `trek.confirm(opts)` (→ `Promise<boolean>`), and `trek.onEvent(cb)` exist
>   only in the 1.4.0 kit. **`npx trek-plugin-sdk` currently resolves 1.3.1**,
>   whose inlined kit does *not* have them (calling them is a TypeError).
>
> The wire protocol is the real contract — you can send/handle these messages
> with hand-rolled `postMessage` on **any** SDK (many plugins roll the bridge
> themselves; `window.trek` is just sugar). So on a 1.3.x kit, speak the wire
> messages directly (they coexist with the rest of the kit), and always keep the
> ≤3.2.1 host fallbacks below — a plugin ships to hosts of both versions.

### Opening external links (`trek:openExternal`)

Plain `<a target="_blank">` / `window.open()` can be blocked: the sandbox is
`allow-scripts allow-forms` — **no `allow-popups`** — so the real frame typically
blocks popups. And the `trek:openExternal` bridge message is only handled by
**hosts ≥ 3.2.2**; on ≤3.2.1 hosts it is silently ignored, so a naive link is
**completely dead** (observed on a real instance: clicks "did nothing"). On SDK
≥ 1.4.0 `trek.openExternal(url)` wraps the bridge send, but you still need the
same ≤3.2.1 fallback. Use the fallback chain and keep the URL user-visible as a
last resort:

```js
function openExternal(url) {
  var w = null
  try { w = window.open(url, '_blank', 'noopener') } catch (e) {}
  if (!w) parent.postMessage({ type: 'trek:openExternal', url: url }, '*')
  // Older hosts ignore the bridge message too — if the link matters, also
  // render the URL as selectable text so the user can copy it manually.
}
```

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
- Widget slots (`capabilities.widget.slot`): `sidebar` renders as a dashboard
  card, `hero` as a boarding-pass-bar overlay (TREK >= 3.2.0), and **`place-detail`
  (≥3.2.1)** as a panel in the trip planner's place inspector (trip mode only,
  gets `placeId`; not shown on the dashboard). **≥3.3.0 adds two more scoped
  slots:** **`day-detail`** (mounts at the foot of the day panel, gets `dayId`)
  and **`reservation-detail`** (mounts under each reservation/journey card, gets
  `reservationId`) — both chrome-free scoped cards like `place-detail`. A
  **`trip-page`** *type* (not a widget slot) mounts a full-frame tab inside every
  trip planner.

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

> **≥3.3.0 re-enables your OWN bundled assets.** In 3.3.0 the per-plugin frame
> CSP appends a scheme-less **own-path host-source** `<host>/plugin-frame/<id>/`
> to `script-src`, `style-src`, `img-src`, `font-src` **and** `connect-src`. So
> the four ❌ own-path rows above flip to **✅ on ≥3.3.0 (own path only)**:
> `<img src="./logo.png">`, `background-image:url(./x.png)`, inline-SVG
> `<image href="./x.png">`, and `@font-face` from a bundled `.woff2` all load —
> and a **multi-file Vite/React build** referencing `./assets/*.js|*.css` works
> **without inlining**. `'self'` still matches nothing at the opaque origin; it
> is this explicit own-path source that re-enables them, and **only** when the
> `Host` header matches `^[a-z0-9.-]+(:\d+)?$` and the id matches
> `^[a-z][a-z0-9-]{2,39}$` — else it silently falls back to inline-only.
> **External `https`/CDN hosts stay blocked;** `data:`/`blob:` still work.
> Keep inlining as the **portable** path: ≤3.2.2 hosts still block these, and the
> re-allow depends on a well-formed `Host` header.

Consequences (**≤3.2.2 hosts** — for ≥3.3.0 own-path assets, see the note above):

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
or fonts. There are two ways to match TREK's look; **prefer the design kit on
≥3.2.1**, fall back to doing it by hand.

### 0. The design kit (≥3.2.1 / SDK 1.3.0 — recommended)

Drop the marker `<!-- trek:ui -->` in your `client/index.html` `<head>`; `dev`
and `pack` expand it into an inlined, token-driven stylesheet + a `window.trek`
bridge (from the SDK's `ui/kit.ts`; `create` scaffolds a client that uses it).
You then get the native TREK look for free:

- **Component classes** (the bootstrap adds `trek-ui` to `<body>`):
  `.trek-glass` / `.trek-card`, `.trek-interactive`, `.trek-btn`
  (`--primary`/`--secondary`/`--ghost`/`--danger`), `.trek-input` /
  `.trek-textarea` / `.trek-select` / `.trek-label`, `.trek-chip`
  (`--accent`/`--success`/`--danger`/`--warning`/`--info`), `.trek-row`,
  `.trek-stack` / `.trek-cluster`, `.trek-title` / `.trek-muted` / `.trek-faint`.
- **`window.trek`**: `onContext(cb)` (fires immediately if context already
  arrived; returns an unsubscribe fn), `context`, `invoke(sub, {method, body})`
  → Promise (rejects with an `Error` whose `.code` = the HTTP status), `notify`,
  `navigate`, `resize`, `ready`, `requestContext`. (**SDK ≥ 1.4.0 + host ≥ 3.2.2
  only** adds `openExternal`, `confirm`, `onEvent` — see the ≥3.2.2 additions
  below and the version note under [Protocol](#protocol); a 1.3.x kit doesn't
  have them.)
- **`window.trek.ui`** (≥3.2.1) — bundler-free DOM builders that emit the kit's
  `trek-*` classes, so you can build themed UI with **no CSS and no build step**:
  `ui.el(tag, props, children)` (the general builder — `props` take
  `class`/`text`/`html`/`on:{event}`), `ui.button(label, {variant, onClick})`,
  `ui.card(children)`, `ui.chip(text, variant)`, `ui.input({type, placeholder,
  value})`, and `ui.mount(node, target?)`. Example:
  `ui.mount(ui.card([ui.el('div',{class:'trek-title',text:'Nearby'}), ui.button('Refresh',{variant:'primary',onClick:refresh})]))`.
- The kit **applies the live `tokens` + appearance for you**, **auto-reports
  height** (no manual `trek:resize`), and **bakes the glassy layer**
  (`--glass-*`, `--r-*`) that is deliberately *not* delivered in `tokens`.
- **Preview it:** `npx trek-plugin-sdk dev`, then open **`/preview`** — a themed
  host with light/dark + accent toggles (see [testing.md](testing.md)).

#### Kit additions in ≥3.2.2 / SDK 1.4.0 (unreleased — npm latest is 1.3.1)

The upcoming SDK 1.4.0 kit (paired with a TREK ≥3.2.2 host) adds — **none of
this is in the 1.3.1 kit `npx` gives you today**:

- **`<select>` auto-upgrade.** The kit bootstrap replaces every native
  `<select>` with a host-styled, keyboard-accessible listbox
  (`.trek-select-trigger` / `.trek-select-menu` / `.trek-select-option`), while
  the **real `<select>` stays in the DOM as the value/form source and still fires
  `change`** — so your existing code keeps working. Opt a field out with
  **`data-trek-native`**; `multiple`/`size` selects are left native. `validate`
  (SDK 1.4.0) now **warns** when `client/index.html` ships a raw `<select>`
  without the kit inlined. On a 1.3.x kit there's no upgrade — style `.trek-select`
  yourself.
- **New `window.trek` helpers** (also listed in the wire-protocol note above):
  `trek.confirm(opts)` → **`Promise<boolean>`** (host-rendered native confirm,
  one at a time; the host prefixes the title with your plugin name so it can't
  spoof a TREK system dialog), `trek.openExternal(url)` (open an `http`/`https`
  URL in a new tab), and `trek.onEvent(cb)` — the client-side counterpart of the
  server `events` surface, firing on core events **and your own `plugin:<id>:*`
  broadcasts** for the trip in view (the `trek:event` message).
- **`trek:notify` gains `duration`** (ms, host-clamped ~1500–15000).
- **RTL:** `trek:context` carries `dir` (`'ltr'|'rtl'`) and the kit sets
  `lang` + `dir` on `<html>`, so kit UI is direction-correct automatically.
- **Motion library in the kit CSS**, all degrading under `[data-reduce-motion]` /
  `prefers-reduced-motion`: `trek-menu-enter`, `trek-popover-enter`,
  `trek-modal-enter`, `trek-toast-enter`, `trek-stagger`, `trek-page-enter`,
  `trek-skeleton`, `trek-pie-reveal`, `trek-bar-fill`. Use these instead of
  hand-rolled keyframes so animation matches TREK and respects reduced-motion.

The rest of this section is the **by-hand path** (no kit): reproduce the tokens
and press-feel yourself, driving them off `trek:context`.

### 1. Mirror TREK's design tokens (by hand / ≤3.2.0)

**≥3.2.1 delivers the whole palette live in `m.tokens`** (and the kit applies it)
— hardcode the hexes below only as a **pre-context default for first paint** and
for **≤3.2.0** hosts that don't send `tokens`. TREK's tokens live in
`client/src/index.css` (`:root` = light, `.dark` = dark); values (verify against
the source — they can drift):

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

> ⚠️ **The `--accent` in this table is monochrome (near-black light / near-white
> dark) — it is NOT the user's real accent colour.** The actual accent the user
> picked arrives only at runtime via **`trek:context.tokens`** (≥3.2.1; the
> kit's `applyTokens` applies it — hand-rolled bridges must copy `tokens` onto
> `:root` themselves). Don't design or tune contrast against the monochrome
> default: anything tinted with `--accent` will render in the host in an
> arbitrary user-chosen hue. Test with `/preview`'s **accent toggle**, and put
> text on accent surfaces in the delivered `--accent-text`, never a hardcoded
> colour.

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

- **No emoji — TREK is lucide-only.** TREK's own interface is emoji-free; use
  inline SVG icons/marks (or the declarative `icon` lucide name in host-rendered
  contributions) and plain text. ⚠️ **≥3.3.0 actively strips emoji** from **every
  plugin-provided string the host renders in its own chrome** — `notify`
  title/body, `tableContributor` columns/actions, trip-card badges, trip
  warnings, map-marker labels, PDF/atlas/journal/place-detail text, etc. Only
  real colour emoji are removed (text symbols `© ® ™ ★` and arrows survive). Your
  own sandboxed `/ui` frame is **exempt** — but the SDK's `validate`/`dev` warn on
  emoji (`hasEmoji`), so keep it out everywhere. (Source: `text-sanitize.ts`.)
- **Size every inline SVG explicitly** (footgun, hit repeatedly in real builds):
  an inline `<svg>` without `width`/`height`/CSS sizing falls back to
  replaced-element defaults and — inside a flex/grid tile — **blows up to fill
  the whole card** (a "small icon" becomes a giant graphic in a banner/button).
  Ship a global baseline and size icons off the font, then override deliberately
  for real artwork:
  ```css
  svg { width: 1em; height: 1em; flex-shrink: 0; }   /* icons follow font-size */
  .artwork svg { width: auto; height: 120px; }       /* explicit for real art  */
  ```
- `--text-muted` for small uppercase kicker labels,
  `font-variant-numeric: tabular-nums` for counts.
- **Buttons — TREK's exact spec** (without the kit; ≥3.2.1's `.trek-btn` already
  bakes all of this, so this block is the by-hand fallback):
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
- Call `trek:resize` after every render/content change so the card fits exactly
  (the design kit does this for you via a `ResizeObserver`).
- Respect `prefers-reduced-motion` for any animation (koffi does).

### 5. Don't draw your own card — `sidebar` vs `page` (and the 3.2.0→3.2.1 change)

A `sidebar` widget renders **inside TREK's own titled card**, so your widget root
must be **chrome-free** — a background, `border`, `border-radius`, or `box-shadow`
on it produces a visible **card-in-card** (doubled borders, mismatched corners).
Render **transparent and flush**; and because the widget is transparent, **pin
`color-scheme` on `:root` per theme** (§2) or the frame paints an opaque light
canvas behind dark-theme content. A full-bleed accent bar at the very top edge is
fine — the card's `overflow-hidden` clips it to the rounded corners.

The card itself **changed between versions**:

- **3.2.0:** a **solid, fixed-180px** box (`bg-surface-card border rounded-xl
  overflow-hidden`, body `height:180`). **`trek:resize` does NOT grow it** —
  content past ~180px is permanently clipped, and `defaultSize` doesn't change
  this. Build for ~180px, essentials above the fold; if inherently tall, ship a
  `page`.
- **≥3.2.1:** a native **glassy auto-height tool card** (`--glass-bg/-border/
  -shadow/-blur`, `--r-xl`, uppercase title + `Blocks` icon in `--ink-3`). The
  body has only a **60px min-height floor** and **`trek:resize` drives the real
  height** (the design kit reports it automatically) — no more 180px clip
  (`PluginWidgets.tsx`).

Either way, keep the root chrome-free and let the host draw the card.

A `page` plugin is the **opposite**: it renders in a full-page shell with **no**
host card (`PluginPage.tsx` → a `calc(100vh - nav)` container + a `w-full h-full`
frame), so you own the whole surface and draw your own layout.

> **≥3.3.0: `page` and `trip-page` frames run in "fill mode" — `trek:resize` is
> ignored.** 3.3.0 gives both full-page hosts (and the scoped detail frames) a
> `fill` prop; `PluginFrame` guards resize with `if (!fill && …)`, so for
> `page` **and** `trip-page` the iframe is locked to **`height:100%` of its
> container** and reported heights are dropped. Consequence: **own an
> internal-scroll layout** (a flex child with `overflow:auto`) rather than
> reporting height — the `ResizeObserver` pattern below and the `trip-page`
> "cap to viewport" trap are both **no-ops on ≥3.3.0** (and the trip-page
> clipping trap is resolved host-side by `fill`). Only the **un-filled `sidebar`
> widget** still uses `trek:resize` for pixel height going forward.

On **≤3.2.2** a `page` frame instead *does* honour `trek:resize` for pixel height
(`PluginFrame` applies `Math.min(height, 2000)`), so you *can* report it on every
layout change (e.g. via `ResizeObserver`):

```js
var lastH = -1
function reportHeight(root) {
  var h = Math.ceil(root.getBoundingClientRect().height) + 2
  if (h !== lastH) { lastH = h; parent.postMessage({ type: 'trek:resize', height: h }, '*') }
}
if (window.ResizeObserver) new ResizeObserver(() => reportHeight(root)).observe(root)
```

> ⚠️ **`trip-page` on ≤3.2.2 — do NOT report unbounded content height.** The host mounts a
> `trip-page` in a fixed, `position:absolute; overflow:hidden` tab wrapper sized to
> the planner viewport (`TripPlannerPage.tsx`), and `PluginFrame` sets the iframe to
> exactly the height you report. Report a height **taller than that viewport and the
> excess is clipped with no scrollbar** — content past the fold is unreachable
> (verified: source + a real instance). So for a `trip-page`, treat the frame as a
> **fixed viewport, not a growing document**: either **don't call `trek:resize` at
> all** (the frame stays `height:100%` of the tab — make a flex child `overflow:auto`
> and scroll internally), or **cap the reported height to the viewport**
> (`Math.min(contentHeight, window.innerHeight)`) and scroll your own content. The
> unbounded-report pattern above is safe for `page` (its container can scroll) but
> **wrong for `trip-page`**. The kit's auto-report is fine because it self-sizes to
> what fits; the trap is a hand-rolled `ResizeObserver` reporting full document
> height on a `trip-page`.

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

**(≥3.2.1)** A **`trip-page`** renders like a `page` — a full-surface iframe
inside a trip-planner tab where you own the layout and `trek:resize` drives the
height — but it's **trip-scoped** (`tripId` always set), so it's the home for a
per-trip tool. A **`place-detail`** widget is a small **chrome-free scoped card**
in the place inspector (like a sidebar widget) and receives both `tripId` and
`placeId` — build it compact and about the one place in view.
