# Client bridge — sandboxed iframe and postMessage protocol

`page`, `widget`, and **`trip-page`** plugins have a client — a
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
  [manifest.md](manifest.md)), plus the plugin's **own asset path** — see
  [What the CSP allows](#what-the-csp-allows--images-fonts-bundled-assets).
- Height: sidebar and scoped-detail widgets request size via `trek:resize`
  (capped at 2000 px); `page`/`trip-page` frames are **fill-mode** — see §5.

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
| `trek:navigate` | `{ to }` | In-app navigation to an **app-absolute path**: must start with `/` and match `^\/[a-zA-Z0-9/_?=&%.-]*$` — query string allowed, but `#` fragments or any character outside that set **silently reject** the navigation; protocol-relative `//…` is rejected |
| `trek:notify` | `{ level, message, duration? }` (`duration` in ms, host-clamped to ~1500–15000) | Toast; `level` = `info` \| `success` \| `warning` \| `error` (unknown level falls back to `info`). `message` is truncated to **200 chars**; an empty message is dropped silently |
| `trek:resize` | `{ height }` | Set iframe height (capped at 2000 px) |
| `trek:invoke` | `{ requestId, sub, method, body }` | Call your own route (`sub` is the path below `/api/plugins/<id>`, query string allowed); resolves as `trek:response` or `trek:error` |
| `trek:openExternal` | `{ url }` | Ask the host to open an `http`/`https` URL in a new browser tab — the **only** way to open a link: the sandbox has no `allow-popups`, so `window.open()`/`target="_blank"` are blocked (see [Opening external links](#opening-external-links-trekopenexternal)) |
| `trek:confirm` | `{ requestId, title?, message, confirmLabel?, cancelLabel?, danger? }` (host-truncated: title ≤120, message ≤500, labels ≤40) | Ask the host to render a **native** confirm dialog (one at a time). The shown title is always `"<pluginName> — <title>"` (just the plugin name if no title), so a plugin can't spoof a TREK system dialog. ⚠️ **`danger` defaults to TRUE** (`danger: msg.danger !== false`) — an unspecified confirm renders **destructive/red**; pass `danger:false` for a neutral one. Host answers with `trek:confirm:result` (correlate by `requestId`). ⚠️ A **second confirm while one is open is auto-answered `{confirmed:false}`** without the user seeing anything — don't fire confirms concurrently |

### Messages TREK sends you (host bridge)

| Message | Payload |
|---|---|
| `trek:context` | `{ tripId, userId, theme, locale, dir, hostOrigin, user, formats, tokens, appearance, placeId, dayId, reservationId }`. `tripId` is **`string \| null`** — `null` for a `page` plugin and a widget with no spotlighted trip, **set for a `trip-page` tab and scoped detail widgets**. `placeId` / `dayId` / `reservationId` (`string \| null`) — each set only for its own scoped slot (`place-detail` → `placeId`, `day-detail` → `dayId`, `reservation-detail` → `reservationId`), else `null`. `userId` is a string or `null`; `user` is `{name, avatar, isAdmin}` or `null` — **never email**. `theme` is `'light'`/`'dark'`; `dir` is `'ltr'`/`'rtl'` (the kit sets `lang` + `dir` on `<html>` from it — hand-rolled UIs should mirror it). `formats` = `{locale, currency, timeFormat, distanceUnit, temperatureUnit, timezone}`; `tokens` = the global palette for the current theme (see §1); `appearance` = `{scheme, density, reducedMotion, noTransparency}`. The host also pushes context **proactively on iframe load** (so `trek:ready` is belt-and-braces) and **re-sends it live** on any theme/appearance change (accent/density/high-contrast/reduced-motion) **and on locale/format-settings/trip-or-entity-id changes** — handle **repeated** `trek:context`, not just the first. See [Making the UI feel native](#making-the-ui-feel-native). |
| `trek:response` | `{ requestId, data }` — successful `trek:invoke` |
| `trek:error` | `{ requestId, code, message }` — failed `trek:invoke`; `code` is the HTTP status or `"error"` |
| `trek:confirm:result` | `{ requestId, confirmed }` — reply to your `trek:confirm` |
| `trek:event` | `{ event, tripId }` — live push of a trip event into the frame for the trip in view: **core events** (`place:created`, `day:updated`, …) **and your own `plugin:<id>:*` broadcasts**. Carries **only** the event name + `tripId`, never the payload — fetch details via `trek:invoke`. This is the **client-side counterpart of the server `events` surface**, and the path that lets your own `ctx.ws.broadcast*` reach your iframe (see [server-api.md](server-api.md)). Treat it as an accelerator on top of an initial fetch, not a replacement — it is **only forwarded to frames mounted with a `tripId`** and only while a planner has the trip joined, so **dashboard `sidebar`/`hero` widgets should still poll** |

> The wire protocol above is the real contract — you can send/handle every
> message with hand-rolled `postMessage` (many plugins roll the bridge
> themselves; `window.trek` is just sugar over exactly these messages). The kit
> helpers `trek.openExternal(url)`, `trek.confirm(opts)` (→ `Promise<boolean>`),
> and `trek.onEvent(cb)` wrap the three newest ones.

### Opening external links (`trek:openExternal`)

Plain `<a target="_blank">` / `window.open()` does **not** work: the sandbox is
`allow-scripts allow-forms` — **no `allow-popups`** — so the frame blocks
popups. Open links through the host instead:

```js
parent.postMessage({ type: 'trek:openExternal', url: url }, '*')
// or, with the kit: trek.openExternal(url)
```

Only `http`/`https` URLs are opened. For load-bearing links, also render the
URL as selectable text so the user can copy it if anything blocks the open.

## Practical notes

- Correlate every `trek:invoke` with a unique `requestId`; responses arrive
  asynchronously and out of order.
- Query parameters go inside `sub` (e.g. `sub: '/state?tripId=' + ctx.tripId`
  — this is exactly what the koffi example does).
- Re-apply `m.theme` on **every** `trek:context` (the host re-sends it on the
  in-app dark toggle), and respect `prefers-reduced-motion` for animation.
- **Live updates arrive as `trek:event`, name-only.** Your own
  `ctx.ws.broadcast*` events and core trip events reach the frame as
  `trek:event { event, tripId }` (use `trek.onEvent(cb)`) — but **never with a
  payload**: on an event, re-fetch the data through your own route via
  `trek:invoke`. See [server-api.md](server-api.md).
- **Never let the frame document navigate itself.** After a second document
  load in the frame, the host **permanently severs the bridge** (all messages
  refused, no more context/events) until the frame is remounted. The sandbox
  has `allow-forms`, so a plain `<form>` submit that navigates the document is
  enough to kill your plugin — always `preventDefault()` and use `trek:invoke`.
- Secrets (`secret: true` settings) are **never** delivered to the iframe —
  fetch derived data through your own server route instead.
- Widget slots (`capabilities.widget.slot`): `sidebar` renders as a dashboard
  card, `hero` as a boarding-pass-bar overlay, and three **chrome-free scoped
  cards** inside the trip planner: **`place-detail`** (place inspector, gets
  `placeId`), **`day-detail`** (foot of the day panel, gets `dayId`), and
  **`reservation-detail`** (under each reservation/journey card, gets
  `reservationId`) — none of the scoped slots appear on the dashboard. A
  **`trip-page`** *type* (not a widget slot) mounts a full-frame tab inside every
  trip planner.

Reference implementation: `plugin-sdk/examples/koffi/client/index.html`
(single self-contained HTML file: `trek:ready` → `trek:context` →
`trek:invoke` with pending-request map).

## What the CSP allows — images, fonts, bundled assets

The frame runs at an **opaque origin** (sandbox without `allow-same-origin`),
where `'self'` matches nothing. What makes bundled assets work anyway is an
explicit **own-path host-source**: the per-plugin CSP appends
`<host>/plugin-frame/<id>/` to `script-src`, `style-src`, `img-src`, `font-src`
**and** `connect-src` — so your **own `client/` files load by relative path**,
but **no external host is ever reachable**:

| You write | Renders? | Why |
|---|---|---|
| Inline `<script>` / inline `<style>` | ✅ | `'unsafe-inline'` is granted |
| Inline SVG (`<svg><path>…`) | ✅ | Markup, not an `img-src` fetch |
| `<img src="data:image/png;base64,…">` | ✅ | `img-src` includes `data:` |
| `<img>` / canvas from a `blob:` URL | ✅ | `img-src` includes `blob:` |
| `<img src="./logo.png">` (a file in your `client/` bundle) | ✅ | Own-path host-source (`<host>/plugin-frame/<id>/`) |
| CSS `background-image: url(./x.png)` / `<image href="./x.png">` in SVG | ✅ | Same own-path source |
| `@font-face` from a bundled `.woff2` | ✅ | Own path is in `font-src` |
| A multi-file Vite/React build (`./assets/*.js`, `*.css`) | ✅ | Own path is in `script-src`/`style-src` — no inlining needed |
| `<img src="https://cdn…/x.png">` | ❌ | No external host in `img-src` |
| Google Fonts / any external stylesheet, script, or font | ❌ | External hosts are never allow-listed (only granted `http:outbound:<host>` hosts, and those only in `connect-src`) |

Caveats and consequences:

* The own-path source is emitted **only** when the request's `Host` header
  matches `^[a-z0-9.-]+(:\d+)?$` and the plugin id matches
  `^[a-z][a-z0-9-]{2,39}$` — otherwise the CSP **silently falls back to
  inline-only**. For load-bearing artwork, inline SVG / `data:` URIs remain the
  most robust choice (the koffi mascot is hand-built inline SVG for this reason;
  inline `<svg>` is confirmed to render in a live instance).
* For logos/mascots/icons prefer inline **vector SVG**: no encoding, scales
  cleanly, themeable via `currentColor`.
* No **external** web fonts (Google Fonts etc.) — bundle a `.woff2` in `client/`
  or use the system stack. TREK's own font is Poppins, but don't hotlink it;
  `system-ui`/`-apple-system` is the safe default.
* No favicons, no icon fonts. Use inline SVG icons.
* Frame asset serving has a **MIME allowlist**
  (`.html/.js/.mjs/.css/.json/.svg/.png/.jpg/.gif/.webp/.woff2/.ico`); anything
  else ships as `application/octet-stream` + `nosniff` — so e.g. `.wasm` or
  `.map` fetches behave differently than in dev. The iframe is also mounted with
  `referrerPolicy="no-referrer"` and `loading="lazy"`.

> **Dev-server caveat:** `trek-plugin dev` serves `/ui` with **no CSP and no
> sandbox**, so a Google font or any other *external* asset works in dev and
> then fails in the real host (bundled files work in both — but the real frame's
> own-path allow depends on a well-formed `Host` header). Verify image/font
> choices against the real CSP (or a harness that applies it), not just `dev`.
> See [testing.md](testing.md).

## Making the UI feel native

The frame inherits **none** of TREK's styling — not its stylesheet, theme class,
or fonts. There are two ways to match TREK's look; **prefer the design kit**,
fall back to doing it by hand.

### 0. The design kit (recommended)

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
  `navigate`, `resize`, `ready`, `requestContext`, `openExternal(url)`,
  `confirm(opts)` → `Promise<boolean>`, `onEvent(cb)` (details below).
- **`window.trek.ui`** — bundler-free DOM builders that emit the kit's
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

More kit features:

- **`<select>` auto-upgrade.** The kit bootstrap replaces every native
  `<select>` with a host-styled, keyboard-accessible listbox
  (`.trek-select-trigger` / `.trek-select-menu` / `.trek-select-option`), while
  the **real `<select>` stays in the DOM as the value/form source and still fires
  `change`** — so your existing code keeps working. Opt a field out with
  **`data-trek-native`**; `multiple`/`size` selects are left native. `validate`
  **warns** when `client/index.html` ships a raw `<select>` without the kit
  inlined.
- **Host-mediated dialogs & links:** `trek.confirm(opts)` →
  **`Promise<boolean>`** (host-rendered native confirm, one at a time; the host
  prefixes the title with your plugin name so it can't spoof a TREK system
  dialog), `trek.openExternal(url)` (open an `http`/`https` URL in a new tab),
  and `trek.onEvent(cb)` — the client-side counterpart of the server `events`
  surface, firing on core events **and your own `plugin:<id>:*` broadcasts** for
  the trip in view (the `trek:event` message).
- **RTL:** the kit sets `lang` + `dir` on `<html>` from `trek:context.dir`, so
  kit UI is direction-correct automatically.
- **Motion library in the kit CSS**, all degrading under `[data-reduce-motion]` /
  `prefers-reduced-motion`: `trek-menu-enter` / `trek-menu-enter-left`,
  `trek-popover-enter`, `trek-modal-enter` (auto-switches to the
  `trek-drawer-enter` mobile variant ≤639px), `trek-backdrop-enter`,
  `trek-toast-enter`, `trek-stagger`, `trek-page-enter`, `trek-skeleton`,
  `trek-pie-reveal`, `trek-bar-fill`, `trek-progress-fill`. Use these instead of
  hand-rolled keyframes so animation matches TREK and respects reduced-motion.

The rest of this section is the **by-hand path** (no kit): reproduce the tokens
and press-feel yourself, driving them off `trek:context`.

### 1. Mirror TREK's design tokens (by hand)

**The host delivers the whole palette live in `m.tokens`** (and the kit applies
it) — hardcode the hexes below only as a **pre-context default for first paint**.
TREK's tokens live in `client/src/index.css` (`:root` = light, `.dark` = dark).
The table below is the **core subset** — the delivered `tokens` object is much
richer (`--warning`/`--info` + the four `--*-soft` fills, `--accent-on`/
`--accent-subtle`, five `--shadow-*`, `--bg-selected`/`--bg-inverse`,
`--overlay`, `--font-subtext`, `--ease-out-quint`, …) — prefer reading
`m.tokens` keys over hardcoding. Fallback values (verify against the source —
they can drift):

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
> picked arrives only at runtime via **`trek:context.tokens`** (the
> kit's `applyTokens` applies it — hand-rolled bridges must copy `tokens` onto
> `:root` themselves). Don't design or tune contrast against the monochrome
> default: anything tinted with `--accent` will render in the host in an
> arbitrary user-chosen hue. Test with `/preview`'s **accent toggle**, and put
> text on accent surfaces in the delivered `--accent-text`, never a hardcoded
> colour.

Radius scale: `--radius-sm 8px`, `--radius-md 12px`, `--radius-lg 16px`,
`--radius-xl 20px`. Card shadow (`--shadow-card`, light):
`0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04)`. TREK's font is Poppins
(`--font-system`), but **external web fonts are CSP-blocked** — don't hotlink
Poppins; bundle a `.woff2` in `client/` or style with
`system-ui, -apple-system, 'Segoe UI', sans-serif`.

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
  // Before context arrives (or if theme is missing) — fall back to the OS scheme
  return window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
// on every trek:context:
document.documentElement.dataset.theme = resolveTheme(m)
```

(For `hero` widgets the host forces `color-scheme: light` on the frame element
anyway — another reason hero artwork should not depend on a dark canvas.)

> **Live theme:** the host derives `theme` from its `<html>.dark` class
> (`PluginFrame.tsx`), watches that class with a `MutationObserver`, and
> **re-posts `trek:context`** when the user flips the in-app dark toggle — so a
> widget that re-applies theme on *every* `trek:context` restyles instantly.
> **Handle repeated context messages, not just the first.** The defensive
> `resolveTheme` above covers first paint before context arrives; a real
> `m.theme` always wins.

### 3. Localize off `m.locale`

`trek:context` carries `locale`. Key your copy off it, English as fallback:

```js
const L = (m.locale || '').toLowerCase().startsWith('de') ? STR.de : STR.en
```

### 4. House style

- **No emoji — TREK is lucide-only.** TREK's own interface is emoji-free; use
  inline SVG icons/marks (or the declarative `icon` lucide name in host-rendered
  contributions) and plain text. ⚠️ **TREK actively strips emoji** from **every
  plugin-provided string the host renders in its own chrome** — `notify`
  title/body, `tableContributor` columns/actions, trip-card badges, trip
  warnings, map-marker labels, PDF/atlas/journal/place-detail text, etc. Only
  real colour emoji are removed (text symbols `© ® ™ ★` and arrows survive). Your
  own sandboxed `/ui` frame is **exempt** — but the SDK's `validate` warns on
  emoji in the manifest name/description, and `dev`'s mock host strips them from
  `notify` just like the real host — keep emoji out everywhere.
  (Source: `text-sanitize.ts`.)
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
- **Buttons — TREK's exact spec** (without the kit; the kit's `.trek-btn` already
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
- In a `sidebar` or scoped-detail widget, call `trek:resize` after every
  render/content change so the card fits exactly (the design kit does this for
  you via a `ResizeObserver`).
- Respect `prefers-reduced-motion` for any animation (koffi does).

### 5. Don't draw your own card — `sidebar` vs `page`/`trip-page`

A `sidebar` widget renders **inside TREK's own titled card**, so your widget root
must be **chrome-free** — a background, `border`, `border-radius`, or `box-shadow`
on it produces a visible **card-in-card** (doubled borders, mismatched corners).
Render **transparent and flush**; and because the widget is transparent, **pin
`color-scheme` on `:root` per theme** (§2) or the frame paints an opaque light
canvas behind dark-theme content. A full-bleed accent bar at the very top edge is
fine — the card's `overflow-hidden` clips it to the rounded corners.

The card is a native **glassy auto-height tool card** (`--glass-bg/-border/
-shadow/-blur`, `--r-xl`, uppercase title + `Blocks` icon in `--ink-3`). The body
has a **60px min-height floor** and **`trek:resize` drives the real height** (the
design kit reports it automatically) — `PluginWidgets.tsx`. Keep the root
chrome-free and let the host draw the card.

A `page` or `trip-page` plugin is the **opposite**: it renders in a full-surface
shell with **no** host card, and both frames run in **fill mode** — the host
passes a `fill` prop and `PluginFrame` guards resize with `if (!fill && …)`, so
the iframe is locked to **`height:100%` of its container** and any reported
height is **dropped**. Consequences:

- **Don't report height** for `page`/`trip-page` — a hand-rolled
  `ResizeObserver` → `trek:resize` loop is a no-op there. `trek:resize` sets
  pixel height for every **un-filled** frame: the `sidebar` card **and** the
  `place-detail`/`day-detail`/`reservation-detail` scoped cards. Only
  `page`/`trip-page` (fill) and `hero` (CSS-pinned) ignore it.
- **Own an internal-scroll layout:** make the root fill the frame and give a
  flex child `overflow: auto` so long content scrolls *inside* your UI:

```css
html, body, #app { height: 100%; margin: 0; }
#app { display: flex; flex-direction: column; }
#app > .content { flex: 1; overflow: auto; }
```

(The kit's auto-height report is harmless in fill-mode frames — the host simply
ignores it there and honours it in the sidebar and scoped-detail cards.)

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

A **`trip-page`** renders like a `page` — a full-surface fill-mode iframe inside
a trip-planner tab where you own the layout — but it's **trip-scoped** (`tripId`
always set), so it's the home for a per-trip tool. The scoped detail widgets
(**`place-detail`** / **`day-detail`** / **`reservation-detail`**) are small
**chrome-free scoped cards** (like a sidebar widget) that receive `tripId` plus
their own id (`placeId` / `dayId` / `reservationId`) — build them compact and
about the one entity in view.
