# Testing — dev server and mock host

## `trek-plugin dev` — run locally without a TREK instance

```bash
npx trek-plugin-sdk dev            # serves http://localhost:4317
```

Works straight after `create`, **no `npm install` needed**: the CLI serves
`require('trek-plugin-sdk')` from itself, in-process — the same minimal frozen
shim (`definePlugin` + `PLUGIN_API_VERSION`) that TREK injects into the plugin
child in production. It loads `server/index.js` through the same `definePlugin`
contract and provides:

- a dashboard listing your routes,
- your routes under **`/api/<path>`** (in production they live under
  `/api/plugins/<id><path>`),
- your page/widget UI at **`/ui`**,
- reload on every save.

Fidelity details:

- The injected `ctx` **enforces exactly the permissions your manifest
  grants** — an ungranted call throws `PERMISSION_DENIED`, so you catch a
  missing grant before install.
- ⚠️ **Dev `ctx` coverage depends on the SDK version.**
  - **SDK 1.3.0 — partial.** The dev `ctx` only implements `db`, `trips`
    (`getById`/`getPlaces`/`getReservations`), `users`, `ws`, `log`, `config`;
    the ≥3.2.1 namespaces (`ctx.meta`, `places`, `days`, `itinerary`, `costs`,
    `packing`, `files`, `trips.update`) are **`undefined`** — a route using them
    throws `Cannot read properties of undefined (reading '…')`. Test those flows
    on a real instance or with `createMockHost`.
  - **SDK 1.4.0 — FULL parity.** `createDevContext` now wraps the same
    **grant-enforcing `createMockHost`** and overrides only `db:own` (real
    `node:sqlite`), `ws` (captured broadcasts), and `log` (console). **Every**
    other namespace — `costs`/`packing`/`files`/`meta`/`places`/`days`/
    `itinerary`/`notify`/`ai`/`settings`/`scheduler`/`oauth`/`weather`/`rates`/
    `journal`/`atlas`/`vacay`/`collections`/`collab`/`tags`/`todos`/`daynotes`/
    `accommodations`/`reservations`/`plugins`/`events` — **works in dev** under
    the same permission/membership/addon gates as production. So on 1.4.0 they are
    **no longer `undefined`**, and the "they throw synchronously, guard with a
    thunk, test on a real instance" advice **no longer applies to the dev server**.
  - **JS gotcha (1.3.0 only):** because a namespace is `undefined`,
    `ctx.meta.get(…)` throws **synchronously at property access** — a
    `try { await attempt(ctx.meta.get(x)) }` won't catch it. Guard with a
    **thunk**: `attempt(() => ctx.meta.get(x))`. **Keep this thunk guard in
    production code regardless of SDK:** the same namespaces have been observed
    partly `undefined` on **real hosts** too — treat `db:own` as the source of
    truth (see [server-api.md](server-api.md#ctx-semantics-and-required-permissions)).
    The point is that it's a **real-host** safeguard, not a dev-server one on 1.4.0.
- `db:own` is backed by a real SQLite file at `.trek-dev/db.sqlite` when the
  Node runtime has `node:sqlite`.
- Simulate an unauthenticated request with `?_anon=1` — an `auth: true` route
  then returns 401, mirroring the host.
- Feed `ctx.*` with fixtures: drop a `dev-fixtures.json` next to the manifest.
  On **SDK 1.3.0** it accepts three keys — `trips`, `users`, `config`. On **SDK
  1.4.0** it **IS the full `MockHostOptions` object** (`dev` passes `{ ...fx }`
  straight into `createMockHost`), so you can seed the entire surface (`costs`,
  `packing`, `files`, `weather`, `ai`, `rates`, `userSettings`, `tags`,
  `journals`, `collections`, `atlasVisited`, `pluginExports`, `declaredEmits`,
  per-trip `can`/`canEdit*` rights, addon-enable toggles, …) — see the
  `createMockHost` options list below. It also honours **`actingUserId`**, which
  dev **defaults to `1`** when omitted, so the documented one-arg user-bound calls
  work on a fresh scaffold:

```json
{
  "config": { "api_key": "test-key" },
  "trips": {
    "1": { "members": [1], "data": { "id": 1, "title": "Japan",
           "start_date": "2026-08-01", "end_date": "2026-08-14" } }
  },
  "users": {}
}
```

### Firing non-route entry points in the dev server (≥ SDK 1.4.0)

Routes are reachable at `/api/<path>`, but jobs, scheduled timers, event
subscriptions, GDPR handlers and provider hooks have no URL of their own. SDK
1.4.0's dev server adds side-effectful **`/__dev/fire/<kind>[/<name>][/<fn>]`**
GET/POST endpoints (the browser-side mirror of `run(def)`):

- `/__dev/fire/job/<id>`
- `/__dev/fire/scheduled/<name>`
- `/__dev/fire/event/<name>`
- `/__dev/fire/deleteUserData` · `/__dev/fire/exportUserData`
- `/__dev/fire/hook/<provider>/<fn>`

Query params become the payload; a JSON body is used verbatim.
`job`/`scheduled`/`event`/GDPR fire against the **userless** ctx (membership reads
refuse, like prod); **hooks stay user-bound**. The endpoints are cross-site-guarded
(`Sec-Fetch-Site`/`Origin`) and loopback-only.

## Dev kit — screenshots + reproducible builds in one step

The skill ships a small vendorable dev-kit under
[`assets/`](../assets/). `setup.sh` drops it into your plugin repo (which must
already contain `trek-plugin.json` — scaffold with `create` first):

```bash
bash <skill>/skills/trek-plugin-dev/assets/setup.sh            # dev-kit only
bash <skill>/skills/trek-plugin-dev/assets/setup.sh --web-hook # + a Claude Code web SessionStart hook
```

It adds:

- **`scripts/shot.mjs`** (+ `scripts/store-shot.html`) and npm scripts:
  - `npm run preview-shot` → `docs/preview-light.png` + `docs/preview-dark.png`
    (the **real** widget via dev's `/preview`, SDK ≥ 1.3.0) — **show these for UI
    sign-off**.
  - `npm run shot` → `docs/screenshot.png` (the composed store image; edit
    `scripts/store-shot.html`'s CONFIG first). `shot.mjs` starts `dev`, captures
    at 1600×900, and stops it; it places the harness in `client/` **only** for the
    shot and deletes it, so it never ships in `plugin.zip`.
- **`.gitattributes`** (`* text=auto eol=lf`) so line endings don't change your
  file bytes across platforms (the CRLF trap). ⚠️ This does **not** make
  `plugin.zip` byte-reproducible: different SDK patch versions produce different
  sha256/size from identical LF sources (zip metadata/mtimes) — the registry
  `sha256`/`size` must always come from the **uploaded release asset**, see
  [publishing.md](publishing.md).
- **`dev-fixtures.json`** template for the dev server.
- **`--web-hook`:** a **SessionStart hook** (`.claude/hooks/plugin-dev.sh`, wired
  into `.claude/settings.json`) that runs `npm install` on each new session — so a
  **Claude Code web** session on the plugin repo is `dev`/`shot`-ready with no
  manual step. Chromium is preinstalled there; no `playwright install` needed.

Needs `playwright` (a devDependency `setup.sh` adds) + a Chromium (present in
Claude Code environments).

## Previewing the UI with an emulated host

The dev server exposes: `/` (a dashboard listing your routes), `/ui` (your
`client/index.html` — live-reload injected, and on **≥ SDK 1.3.0** the
`<!-- trek:ui -->` marker expanded; other assets byte-verbatim), `/api/<path>`
(your routes), and — **≥ SDK 1.3.0** — **`/preview`**: a **themed host** that
embeds `/ui` in a sandboxed opaque-origin iframe (exactly TREK's isolation) and
speaks the full bridge — it posts `trek:context` with **light/dark + accent +
appearance toggles**, proxies `trek:invoke` to `/api`, and handles
resize/notify/navigate. So on ≥1.3.0 you preview the themed UI **without any
harness** — just open `/preview`.

`/preview` still sets **no CSP** (like `/ui`), so it reproduces the sandbox +
bridge + theming but **not** the per-plugin CSP — validate image/font choices
against the real frame (see the CSP caveat in
[client-bridge.md](client-bridge.md)).

**On older SDKs (≤1.2.1)** there is no `/preview` and **nothing answers the
bridge**: open `/ui` and no parent replies to `trek:ready`/`trek:invoke`, so a
widget stays stuck in its loading state. Build the small host harness below to
drive it. (The harness is also the basis for the composed store image — see
[store-shot.html](../assets/store-shot.html) — which `/preview` does not produce.)

> **Show the draft, don't describe it.** As soon as a page/widget UI first
> renders, screenshot it (both light and dark) via `/preview` or the harness
> below and **show the user for sign-off** before polishing — the UI is
> subjective, so get their "looks right" before investing further. Chromium is
> preinstalled; `page.screenshot(...)` the frame.

To exercise the full UI loop — and to capture a real `docs/screenshot.png` —
wrap the frame in a tiny host harness that speaks the bridge and proxies invokes
to the dev API:

```html
<iframe id="f" src="http://localhost:4317/ui"></iframe>
<script>
  const f = document.getElementById('f')
  addEventListener('message', async (e) => {
    const m = e.data; if (!m) return
    if (m.type === 'trek:ready' || m.type === 'trek:context:request') {
      f.contentWindow.postMessage(
        { type: 'trek:context', tripId: 1, userId: '1',
          theme: 'dark', locale: 'en', hostOrigin: '*' }, '*')
    } else if (m.type === 'trek:invoke') {
      const r = await fetch('http://localhost:4317/api' + m.sub,
        { method: m.method, headers: { 'content-type': 'application/json' },
          body: m.body ? JSON.stringify(m.body) : undefined })
      f.contentWindow.postMessage(
        { type: 'trek:response', requestId: m.requestId, data: await r.json() }, '*')
    } else if (m.type === 'trek:resize') {
      f.style.height = m.height + 'px'
    }
  })
</script>
```

**Simplest same-origin setup:** save the harness as **`client/harness.html`** —
`dev` serves the whole `client/` tree under `/ui/` (`/ui/<file>` →
`client/<file>`), so it's reachable at `http://localhost:4317/ui/harness.html`,
same-origin with `/api/…` (no CORS; `fetch('/api/state')` just works). ⚠️
**Delete it before `pack`** — `pack` zips the entire `client/` tree, so a stray
`harness.html` ships inside `plugin.zip`.

This renders the widget with live data and is how you produce a faithful
`docs/screenshot.png` — but it does **not** apply the production CSP, so still
validate image/font choices against the real frame.

### One screenshot, multiple themes/states

The harness page is a plain page you screenshot — **not** a plugin frame — so
it's free of the production CSP and can use gradients, layout, and several
frames. To show light + dark (or e.g. healthy vs. low-balance) **side by side in
one image**, mount several `<iframe src="/ui">` and give **each its own
context**, keyed by `e.source` (each iframe's `contentWindow` is a distinct
`e.source`):

```js
const frames = new Map()   // e.source -> { theme, state }
function register(iframe, cfg) { frames.set(iframe.contentWindow, cfg) }
addEventListener('message', (e) => {
  const cfg = frames.get(e.source); if (!cfg) return
  const m = e.data
  if (m.type === 'trek:ready' || m.type === 'trek:context:request') {
    e.source.postMessage({ type: 'trek:context', tripId: 1, userId: '1',
      theme: cfg.theme, locale: 'en', hostOrigin: '*' }, '*')
  } else if (m.type === 'trek:invoke') {
    e.source.postMessage({ type: 'trek:response', requestId: m.requestId,
      data: cfg.state }, '*')          // per-frame mocked state
  }
})
// register(document.getElementById('light'), { theme:'light', state:{…} })
// register(document.getElementById('dark'),  { theme:'dark',  state:{…} })
```

Then `page.screenshot({ path })` at a 1600×900 viewport (`deviceScaleFactor 1`).
Keep key content centred so the 16:10 discover-card crop never clips it (see
[publishing.md](publishing.md)).

**Composition template (1600×900)** — treat it as a marketing shot, not a raw
frame grab:

- a **full-bleed background with real colour that fits the plugin** — either a
  **dark, atmospheric accent *glow*** (like a premium hero shot) or a **light
  colourful accent *mesh***, plus a subtle **pattern** (waves / dots / grid) so
  it isn't flat and boring. Keep the colour toward the edges/behind the title so
  the centre stays calm and the cards/title stay focal. **Never a flat pale
  gradient.** (`store-shot.html` builds exactly this from its CONFIG —
  `background: 'glow'|'mesh'`, `accent`/`accent2`, `pattern`, `kicker` — match
  them to what the widget shows, e.g. a Japanese-phrase plugin → warm coral glow
  + a native-script kicker.)
- a centred **title band**: the plugin **name** + a one-line tagline (system
  font, `--text-primary` / `--text-muted`);
- the widget in **both themes**, two "cards" side by side — here you *may* draw
  TREK-style card chrome (`--bg-card`, `1px solid --border-faint`, `--radius-lg`,
  `--shadow-card`) around each `<iframe>`, because this is the presentation image,
  **not** the real in-TREK render (where the host draws the card and your widget
  stays chrome-free — see [client-bridge.md](client-bridge.md) §5);
- optional row of 3–4 **feature pills** (rounded `--bg-hover` chips, `--text-muted`)
  beneath the cards;
- keep the whole composition inside the centre ~1000px so the 16:10 crop never
  clips the title or a card.

The light+dark pair reads as a real product card and signals theme support at a
glance. Swap each frame's mocked `state` (e.g. healthy vs. alert) to also show
the widget *doing something*, not just sitting idle.

**Ready-made template:** [`assets/store-shot.html`](../assets/store-shot.html)
implements exactly this layout (gradient, title/tagline, both-theme cards with
TREK card chrome, pills, per-`e.source` bridge). Copy it to `client/harness.html`,
edit the `CONFIG` block (name, tagline, pills, the two frames' theme + mocked
`state`), open `/ui/harness.html`, screenshot at 1600×900 — then **delete it
before `pack`**.

## `createMockHost` — unit tests

Import from **`trek-plugin-sdk/testing`**. The mock enforces the **same**
permission model as the real host, so tests can prove graceful degradation
when a grant is missing.

```ts
export interface MockHostOptions {
  grants?: string[];                        // permissions to grant the ctx
  config?: Record<string, unknown>;         // becomes ctx.config (frozen)
  actingUserId?: number;                    // (≥3.2.1) host-bound user — required for any costs.*
  budgetAddonEnabled?: boolean;             // (≥3.2.1) default true; false → RESOURCE_FORBIDDEN
  // (≥3.3.0 / SDK 1.4.0) more addon-enable flags (each defaults true; false → RESOURCE_FORBIDDEN):
  journeyAddonEnabled?; atlasAddonEnabled?; vacayAddonEnabled?; collectionsAddonEnabled?; collabAddonEnabled?: boolean;
  // (≥3.3.0) inter-plugin + per-user + broker fixtures:
  pluginExports?; declaredEmits?; userSettings?; tags?; journals?; journalEntries?; collections?;
  atlasVisited?; atlasBucketList?; vacayPlan?; categories?; weatherResult?; ratesResult?; aiText?; aiResults?; oauthAccessToken?;
  /** Fixtures keyed by trip id; `members` gates access like the real host. */
  trips?: Record<number, { members: number[]; data?: unknown;
                           places?: unknown[]; reservations?: unknown[];
                           costs?: unknown[]; canEditCosts?: boolean;      // (≥3.2.1)
                           days?: unknown[]; assignments?: unknown[];      // (≥3.2.1)
                           packing?: unknown[]; files?: unknown[];         // (≥3.2.1) ctx.packing/files.list
                           accommodations?; bags?; todos?; daynotes?;      // (≥3.3.0)
                           notes?; polls?; messages?;                      // (≥3.3.0) collab
                           canEditPlaces?; canEditDays?; canEditTrip?: boolean; // (≥3.3.0) write gates
                           /** (≥3.3.0) app-right gate keyed by right name:
                            *  member_manage, reservation_edit, packing_edit, collab_edit,
                            *  file_upload/file_edit/file_delete (todos ride on packing_edit) */
                           can?: Record<string, boolean> }>;
  users?: Record<number, unknown>;
  /** Canned db.query results, keyed by the EXACT sql string. */
  queryResults?: Record<string, unknown[]>;
}

export interface MockHost {
  ctx: PluginContext;
  userlessCtx: PluginContext;                          // (≥3.3.0) the ctx a job/scheduled/event/GDPR handler gets — NO acting user
  calls: { method: string; args: unknown[] }[];        // permission-checked call names (db/trips/users/ws — not log).
                                                       // args is [] for those; (≥3.3.0) settings.get/plugins.call/events.emit push REAL args
  logs: { level: string; msg: string }[];
  broadcasts: { kind: 'trip' | 'user'; target: number; event: string; data: unknown }[];
  emitted: { name: string; payload: unknown }[];       // (≥3.3.0) ctx.events.emit records
  notifications: unknown[];                            // (≥3.3.0) ctx.notify.send records
  scheduled: Map<string, unknown>;                     // (≥3.3.0) ctx.scheduler timers
  run(def): PluginDriver;                              // (≥3.3.0) fire the plugin's OWN entry points — see below
}

export function createMockHost(opts?: MockHostOptions): MockHost;
```

### Driving the plugin's own handlers — `run(def)` (≥3.3.0 / SDK 1.4.0)

`createMockHost(...).run(def)` returns a **`PluginDriver`** that fires the
plugin's **own** entry points against the mock ctx — the "assert what the plugin
DID" half of a unit test:

```js
const h = createMockHost({ grants: ['jobs:run', 'db:own'] })
const drv = h.run(def)
await drv.load(); await drv.unload()
await drv.route(0, req)                 // or route({ method:'GET', path:'/status' }, req)
await drv.job('refresh')               // runs against userlessCtx
await drv.scheduled('digest', payload) // userless
await drv.event('place:created', payload)          // userless
await drv.pluginEvent('other-plugin', 'rate.updated', payload) // userless
await drv.deleteUserData(42); await drv.exportUserData(42)     // userless GDPR
await drv.hook('placeDetailProvider', 'getDetails', placeId)  // user-bound
```

**Routes and hooks run user-bound; `job`/`scheduled`/`event`/`pluginEvent`/GDPR
run against `userlessCtx`** — so a membership read from a background job fails in
test exactly as it would in production. Use it as the **primary way** to test
jobs, scheduled timers, event/plugin-event subscriptions, GDPR export/delete, and
provider hooks.

Example:

```js
import { createMockHost } from 'trek-plugin-sdk/testing'

const { ctx, broadcasts } = createMockHost({
  grants: ['db:read:trips'],
  trips: { 1: { members: [42], data: { id: 1, name: 'Japan' } } },
})

await ctx.trips.getById(1, 42)                       // ok — user 42 is a member
await expect(ctx.trips.getById(1, 99)).rejects       // RESOURCE_FORBIDDEN
  .toThrow(/RESOURCE_FORBIDDEN/)
await expect(ctx.db.query('SELECT 1')).rejects       // PERMISSION_DENIED (no db:own)
  .toThrow(/PERMISSION_DENIED/)
```

Notes:

- The mock db is a **recorder**, not a database: configure `queryResults` for
  canned rows (keyed by the exact SQL string); use an integration test (or the
  dev server's real SQLite) for real SQL. **(≥3.3.0) it also enforces the host's
  statement guards** — `query`/`exec`/`migrate` reject `FORBIDDEN_SQL`
  (`ATTACH`/`DETACH`/`VACUUM`/`PRAGMA`/`RECURSIVE`/`LOAD_EXTENSION`) and > 100k-char
  SQL, and **`db.tx(ops)` is implemented** (≤ 100 ops, each SQL-guarded,
  transaction-control keywords `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`/`RELEASE`/
  `END` rejected even behind leading comments; reads resolve from `queryResults`,
  writes report `{changes:0}`). So tests catch disallowed SQL and exercise
  `db.tx` batches without a real database.
- `broadcasts` collects `ws.broadcastTo*` calls so you can assert on events
  without a socket. **(≥3.3.0) both are target-gated like prod:** `broadcastToTrip`
  refuses without an acting user and membership-checks the trip; `broadcastToUser`
  allows only the acting user themselves. `users.getById` returns **only public
  columns** (`id/username/display_name/avatar`, never email/role) and only for
  someone the acting user can see (self or a co-membered trip) — foreign ids
  throw `RESOURCE_FORBIDDEN`.
- `calls` records the attempt **even when the grant is missing** (the entry is
  pushed before the permission check throws), so a `PERMISSION_DENIED` call still
  appears in `calls`.
- **(≥3.2.1) Testing `ctx.costs.*`:** set `actingUserId` (the host-bound user)
  and seed `trips[id].costs`. `canEditCosts: false` simulates a missing
  `budget_edit` for `create`; `budgetAddonEnabled: false` simulates the addon
  being off (both → `RESOURCE_FORBIDDEN`). Cover happy-path, missing-grant,
  missing-`budget_edit`, and addon-off cases.
- **(≥3.3.0) `userlessCtx`** is the ctx a job / scheduled task / event
  subscription / GDPR handler receives — bound to **no acting user**. Every
  user-bound read/write on it throws `RESOURCE_FORBIDDEN` ("this call requires an
  authenticated user context"); it shares the same fixtures/grants/recorders.
  `run()`'s `job`/`scheduled`/`event`/`pluginEvent`/`deleteUserData`/
  `exportUserData` all use it — so test that background handlers **degrade
  gracefully without a user** (fall back to `ctx.config`/`db:own`, not user-bound
  reads).
- **(≥3.3.0) `notify.send` is fully modelled:** title/body emoji-stripped (an
  all-emoji title collapses to `''` and is **rejected**), `title` ≤ 200 / `body`
  ≤ 1000 required, `scope` must be `'user'`/`'trip'`, a `'user'` target must
  equal the acting user (else `RESOURCE_FORBIDDEN`), a `'trip'` target is
  membership-checked, `link` must be an in-app `/…` path (not `//…`, ≤ 512).
  Assert on the **`notifications`** array.
- **(≥3.3.0) member management + per-trip rights:** `addMember`/`removeMember`
  need `db:write:members` + the fixture's `can.member_manage`, verify the target
  exists, no-op for owner/existing member (`joined:false`), and refuse removing
  the owner. Set `canEditPlaces`/`canEditDays`/`canEditTrip` or a `can` entry
  (`reservation_edit`/`packing_edit`/`collab_edit`/`file_*`) to `false` to test
  the permission-denied write paths.
- **(≥3.3.0) addon-off pattern generalises:** each of `budgetAddonEnabled` /
  `journeyAddonEnabled` / `atlasAddonEnabled` / `vacayAddonEnabled` /
  `collectionsAddonEnabled` / `collabAddonEnabled` (all default true) → set
  `false` to prove your plugin degrades when the addon is disabled
  (`RESOURCE_FORBIDDEN`).
- Mock ctx id is `mock-plugin`; `config` is frozen like the real one.
- Differences vs the real host worth knowing: the mock's `trips.getById`
  honors the `asUserId` argument for membership checks (that's the point of
  the fixture `members`), while the **real host ignores `asUserId`** and binds
  the acting user from the authenticated request.

## Recommended test strategy

1. Unit-test route handlers with `createMockHost` — happy path, missing
   grant (`PERMISSION_DENIED`), foreign trip (`RESOURCE_FORBIDDEN`).
2. Exercise the full loop (routes + UI + fixtures) in `trek-plugin dev`.
3. Before publishing, run `validate` → `pack` → `preflight` (see
   [publishing.md](publishing.md)) — preflight replays the registry CI,
   including the README gate, over the network.
