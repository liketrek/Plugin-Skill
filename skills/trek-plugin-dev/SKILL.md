---
name: trek-plugin-dev
description: Build, test, and publish plugins for TREK, the self-hosted travel planner (github.com/mauriceboe/TREK). Covers the trek-plugin.json manifest, the definePlugin server API and ctx object, the sandboxed iframe postMessage bridge for widget/page UIs, permissions and egress rules, local development with trek-plugin-sdk (create/dev/validate/pack), and publishing to the TREK-Plugins community registry including every CI gate. Use when creating or modifying a TREK plugin, working with trek-plugin-sdk or trek-plugin.json, debugging PERMISSION_DENIED / RESOURCE_FORBIDDEN or registry CI failures, or preparing a TREK-Plugins registry entry or PR.
---

# TREK Plugin Development

Build plugins for [TREK](https://github.com/mauriceboe/TREK), a self-hosted
trip-planning app. A plugin is a directory with a manifest (`trek-plugin.json`),
a built CommonJS server entry (`server/index.js`), and — for `page`/`widget`
(and `trip-page`, ≥3.2.1) types — a static client bundle (`client/`). TREK runs the server part in an
**isolated child process** reached only over RPC, and the UI in a **sandboxed,
opaque-origin iframe**. Distribution happens through the
[TREK-Plugins](https://github.com/mauriceboe/TREK-Plugins) registry: a static
index updated by pull request; plugin code and releases stay in the author's
own public GitHub repo.

Everything is driven by the npm package **`trek-plugin-sdk`** (Node >= 18):
`definePlugin` + types, a permission-enforcing mock host for tests, and the
`trek-plugin` CLI (`npx trek-plugin-sdk <command>`).

## Reference files — read before working on that area

| Task at hand | Read |
|---|---|
| Writing/editing `trek-plugin.json`, permissions, egress, settings | [references/manifest.md](references/manifest.md) |
| Server code: `definePlugin`, routes, jobs, `ctx.*`, error codes | [references/server-api.md](references/server-api.md) |
| Widget/page UI: iframe sandbox, postMessage bridge, CSP | [references/client-bridge.md](references/client-bridge.md) |
| Local dev server, fixtures, unit tests with `createMockHost` | [references/testing.md](references/testing.md) |
| Any `trek-plugin` CLI command and its flags | [references/cli.md](references/cli.md) |
| Releases, registry entries, CI gates, signing, updates | [references/publishing.md](references/publishing.md) |

## Golden path

```bash
# 1. Scaffold (id must be a lowercase slug, 3–40 chars)
npx trek-plugin-sdk create my-widget --type widget    # or: page | integration

# 2. Develop: edit trek-plugin.json, server/index.js, client/index.html
cd my-widget
npx trek-plugin-sdk dev            # http://localhost:4317 — hot reload,
                                   # real permission enforcement, no TREK needed

# 3. Check + build artifact
npx trek-plugin-sdk validate .
npx trek-plugin-sdk pack .         # plugin.zip + prints sha256 and size

# 4. Publish: public GitHub repo (convention: trek-plugin-<id>),
#    README filled in, docs/screenshot.png committed, then ONE command:
npx trek-plugin-sdk publish --repo you/trek-plugin-my-widget --tag v1.0.0
#    = pack → git tag + GitHub release → preflight (registry CI, locally)
#      → opens the registry PR. Stops before submitting if preflight fails.
#    Add --sign to sign the artifact (recommended). Requires git + gh (authed).
```

Update flow: bump `version` in the manifest, re-pack, new `vX.Y.Z` tag/release
(asset attached **before** `entry` — else `artifact not found`), then
`entry --merge` onto the existing registry file (newest version first) and PR it.
There's also a hand-edit path for updating an entry by hand — see "Updating a
published plugin" in [references/publishing.md](references/publishing.md).

## Build the UI / store shot *with* the user, not for them

For a `page`/`widget` plugin the look is subjective — **don't silently pick it,
and don't just describe it in words.** Two rules:

**1. Propose choices interactively, with suggestions.** Before and while building
the UI and the store image, offer the user concrete options tailored to the
plugin and let them choose (use an interactive prompt — e.g. Claude Code's
question UI — not an assumption). Good dimensions to ask about, each with **2–4
suggestions derived from what the plugin does**:

- **Accent colour(s)** — hues that match the subject (weather → sky blue +
  sunset orange; a Japanese-phrase plugin → warm coral).
- **Store-shot background** — dark & atmospheric (an accent *glow*) vs. light (a
  colourful accent *mesh*).
- **Pattern/texture** — waves / dots / grid / none (some texture so it isn't flat
  and boring).
- **Kicker, tagline, and which feature pills** to show.
- **Layout** — light + dark side by side (shows theme support) vs. a single hero.

**2. Show the draft as a screenshot for sign-off** — don't ship on a description:

- **One command:** the dev-kit's `npm run preview-shot` writes
  `docs/preview-light.png` + `docs/preview-dark.png` (the real widget via
  `/preview`); `npm run shot` writes the composed store image. Set it up once with
  [`assets/setup.sh`](assets/setup.sh) (`--web-hook` for Claude Code web). See
  [references/testing.md](references/testing.md#dev-kit--screenshots--reproducible-builds-in-one-step).
- Or drive it headlessly yourself (Chromium/Playwright is preinstalled).
  Screenshot **both light and dark**.
- **≥ SDK 1.3.0:** open `dev`'s themed **`/preview`** (light/dark/accent toggles).
- **For the composed store image:** the ready-made
  [`assets/store-shot.html`](assets/store-shot.html) renders both-theme cards +
  title + feature pills on an accent-driven background (`glow`/`mesh` ·
  `waves`/`dots`/`grid`) — set its CONFIG from the choices above.
- Present the image(s), ask *"does this look right?"*, and iterate. The approved
  shot doubles as the store `docs/screenshot.png`.

See [references/testing.md](references/testing.md).

## Choosing the plugin type

| `type` | Surfaces | Use for |
|---|---|---|
| `widget` | Dashboard card (`sidebar` slot — ~180px on 3.2.0, glassy auto-height on ≥3.2.1) or a **non-interactive** boarding-pass hero strip (`hero` slot, ~110px, desktop-only). **(≥3.2.1)** also the `place-detail` slot → a panel in the trip planner's place inspector (gets `placeId`); **(≥3.3.0)** also `day-detail` (gets `dayId`) and `reservation-detail` (gets `reservationId`) | At-a-glance info (flight status, weather, mascot); a per-place/day/reservation add-on |
| `page` | Own entry in the top navigation → full-page iframe (you own the layout) | A self-contained tool |
| `trip-page` **(≥3.2.1)** | A tab **inside every trip planner**, scoped to the open trip (`tripId` always set); full-frame like `page`, no dashboard nav. **(≥3.3.0)** `capabilities.tripPage` can replace core tabs / set tab position (tab-takeover) | A per-trip tool |
| `integration` | No UI; background routes, plus **wired provider hooks** (≥3.2.1: place-detail / trip-warning; **≥3.3.0: table / map-marker / pdf-section / atlas-layer / journal-entry / trip-card**, plus photo/calendar now consumed) | Feeding/syncing data; enriching core UI natively |

Note: **`jobs[]` scheduling is version-dependent.** ≤3.2.1: **declared but never
scheduled** (no cron runner) — build periodic work as routes. **≥3.3.0: jobs run
via node-cron when the `jobs:run` grant is present** (opt-in, userless), and a
persistent **`ctx.scheduler`** (`at`/`in`/`every`/`cancel`, also `jobs:run`) adds
restart-surviving one-shot/recurring callbacks into a `scheduled` handler. **To
react to core activity, use `events` (≥3.2.1, WIRED):** `events: [{ on, handler }]`
+ `events:subscribe`; the handler gets `{ event, tripId }` (**≥3.3.0 also
`entity`/`entityId`/`snapshot`** when you hold the family's `db:read:*`), runs with
no user, fire-and-forget. The `hooks` surface: ≤3.2.1
`photoProvider`/`calendarSource` **validate but aren't consumed** while
`placeDetailProvider`/`warningProvider` **are wired**; **≥3.3.0 wires six more**
(table/map-marker/pdf-section/atlas-layer/journal-entry/trip-card) **and** consumes
photo/calendar, plus a GDPR **`hook:user-data`** (`deleteUserData`/`exportUserData`,
userless, own-db) — so an `integration` can inject native UI or honour data-rights
with no iframe. See [references/server-api.md](references/server-api.md).

## Critical rules (violating any of these breaks install or CI)

1. **Never vendor `trek-plugin-sdk`.** The host makes
   `require('trek-plugin-sdk')` resolve inside the child at runtime. Keep it a
   **devDependency**. Any *other* runtime dependency must be vendored/bundled —
   TREK never runs `npm install` on a plugin.
2. **Ship built CommonJS.** `package.json` carries `"type": "commonjs"`;
   `server/index.js` is plain built JS (`.ts` and `.map` files are stripped by
   `pack`). Client files are pre-built static assets.
3. **Egress trap:** the runtime network guard and the iframe CSP are built from
   the **`http:outbound:<host>` permissions**, *not* from `egress[]` (which is
   only checked for presence). A host listed in `egress[]` but not granted as
   `http:outbound:<host>` is **silently blocked at runtime**. Keep both lists
   identical. Bare `http:outbound` alone reaches nothing.
4. **`ctx.trips`, `ctx.users`, `ctx.costs`, `ctx.ws.*` — and (≥3.2.1)
   `ctx.packing`/`ctx.files`/`ctx.places`/`ctx.days`/`ctx.itinerary`/`ctx.trips.update`/`ctx.meta` — work
   only inside route handlers** (they need the acting user the host binds from the
   request; from `onLoad`/jobs/**events** → `RESOURCE_FORBIDDEN`). `asUserId` is ignored;
   `ctx.users` returns only self or a trip co-member; `ctx.ws.broadcastToUser`
   targets only the acting user — and **no broadcast reaches your own iframe**
   (poll via `trek:invoke`). **(≥3.2.1) several `ctx.*` paths now write core TREK
   data** (`places`/`days`/`itinerary`/`trips.update`, plus `costs.create`): each
   is route-only and gated on the acting user's matching edit permission
   (`place_edit`/`day_edit`/`trip_edit`/`budget_edit`), exactly like the web UI.
   `ctx.meta` stores the plugin's own namespaced data on a trip/place/day (reads
   need trip access, writes the entity's edit permission). **Heads-up: these
   ≥3.2.1 namespaces (`meta`/`places`/`days`/`itinerary`/`costs`/`packing`/`files`/
   `trips.update`) have been observed partly `undefined` on real hosts** (the dev
   server has full parity on the current SDK). Treat them all as optional: `db:own`
   as source of truth, `ctx.meta` only a best-effort mirror, every optional call
   behind a thunked guard (`attempt(() => ctx.meta.set(…))` — the thunk also
   catches the synchronous property throw). See
   [server-api.md](references/server-api.md) and
   [testing.md](references/testing.md). Budget amount key is **`total_price`**,
   not `amount` (unknown keys are silently dropped → saves 0). **(≥3.3.0) the
   `ctx.*` surface roughly triples** — new booking/roster/personal-data DB
   namespaces (`reservations`/`accommodations`/`packing` writes+bags/`collab`/
   `journal`/`atlas`/`vacay`/`collections`/`daynotes`/`todos`/`tags`/`categories`/
   `trips.members`+`addMember`+`create`/`files.getContent`+writes), `ctx.meta` now
   also on `reservation`/`accommodation`, `ctx.settings.get` for per-user settings,
   `ctx.db.tx` atomic batches, and `ctx.plugins.call`/`ctx.events.emit` for
   inter-plugin calls — each behind its own new permission (see
   [manifest.md](references/manifest.md)).
   **Host brokers (≥3.3.0) are a distinct, non-DB family** — `ctx.notify`
   (`notify:send`), `ctx.ai` (`ai:invoke`), `ctx.oauth` (`oauth:client`),
   `ctx.weather` (`weather:read`), `ctx.rates` (`rates:read`): `notify`/`oauth`
   are acting-user-scoped (route-only), `ai`/`weather`/`rates` are tenant-free
   (work userless). AI output is **data-only** — never treat it as instructions.
   If your plugin stores personal data, implement the GDPR **`hook:user-data`**
   (`deleteUserData`/`exportUserData`, userless, own-db).
5. **No native modules** — `.node`, `binding.gyp`, `prebuilds/` are refused at
   pack, CI, and install time. `nativeModules` must be `false`/absent.
6. **Git tag == manifest `version`** (`v1.2.3` ↔ `"version": "1.2.3"`), and the
   registry pins the release asset's exact **sha256** — never re-upload or
   mutate a released `plugin.zip`; cut a new version instead. The zip is **not
   byte-reproducible** (different machines/SDK patch versions → different
   sha256+size from identical sources), so always take `sha256`/`size` **from
   the uploaded release asset**, never from a local re-pack — see
   [references/publishing.md](references/publishing.md).
7. **README quality gate is a hard CI gate:** sections **What it does /
   Screenshots / Permissions / Setup** (substring-matched, any heading level),
   ≥ 400 chars of real prose, at least one screenshot whose URL returns
   `Content-Type: image/*` (a committed file — `data:` URIs don't count), no
   leftover placeholders (`{{…}}`, `REPLACE_ME`, `Describe what/the …`,
   `your-name/trek-plugin`), and **every declared permission string must appear
   in the README**. See [references/publishing.md](references/publishing.md).
8. **`docs/` is not shipped** in `plugin.zip` (by design). Commit
   `docs/screenshot.png` to the repo — the store fetches it from GitHub at the
   pinned commit.
9. **Reserved ids:** `registry`, `install`, `rescan`. Everything else matching
   `^[a-z][a-z0-9-]{2,39}$` is allowed and bound to your GitHub owner on first
   registration (nobody can repoint it later).
10. **Registry PR = exactly one file**, `registry/plugins/<id>.json`. Never
    touch `dist/` (generated on merge) or set `reviewedAt`/`boundOwner`
    (CI-maintained).
11. **Signing is a one-way door:** once a plugin ships signed, an unsigned or
    differently-keyed update is refused until an admin re-trusts it. Back up
    `~/.trek-plugin/signing.key`.
12. **Manifest `routes[]` and `capabilities.nav` are declarative only.** The
    host reads real routes off the loaded `definePlugin` object; a page's nav
    entry uses top-level `name` as its label but a **fixed `Blocks` icon** — the
    manifest `icon` is *not* used for nav (only on the Admin/store card).
13. **The UI frame renders no bundled or external images/fonts (≤3.2.1).** It runs
    at an opaque origin under a strict CSP (`img-src 'self' data: blob:`,
    `font-src 'self' data:`) where `'self'` matches nothing — so relative file
    paths (`./logo.png`) and external URLs don't load; only inline SVG,
    `data:`/`blob:` images, and the system font stack work. Draw artwork as
    inline SVG (like koffi). **≥3.3.0 re-enables your OWN bundled assets** via an
    own-path CSP source (`./logo.png`, bundled `.woff2`, a multi-file Vite/React
    build load without inlining — external CDNs still blocked); keep inlining as
    the portable path for ≤3.2.1. `trek-plugin dev` applies **no** CSP/sandbox, so
    an image that works in `dev` can still fail in the real host — verify against
    the real frame. See [references/client-bridge.md](references/client-bridge.md).

## Isolation model (what plugin code can rely on)

- Own OS process under Node's permission model; filesystem reads scoped to the
  plugin's own code. No `JWT_SECRET`, no `trek.db`, no file writes, no child
  processes, no worker threads.
- All host access via the `ctx` object; an ungranted capability throws
  `PERMISSION_DENIED`, an unknown method `UNKNOWN_METHOD`.
- Own data only through `ctx.db` (a private SQLite file, requires `db:own`).
- UI iframe: opaque origin (sandbox without `allow-same-origin`), no cookies,
  no parent DOM; talks to TREK only via `postMessage` with target origin `'*'`;
  CSP `default-src 'none'`, `connect-src` limited to granted hosts.
- **(≥ 3.2.1)** the raw child↔host IPC channel is sealed before your code loads —
  `process.send` / `process.on('message')` / `disconnect` are revoked; `ctx` is
  the only channel in.
- Crash/hang/OOM kills only the plugin's process; TREK keeps running. Watchdog:
  RSS 300 MB, 192 MB heap, 30 s `onLoad`/route timeouts, 5 crashes/5 min →
  auto-disabled (see [references/server-api.md](references/server-api.md)).
- **(≥3.3.0) Per-plugin RPC rate limit:** a token bucket at the `ctx` dispatch
  boundary (defaults burst 60, 20/s, 16 in-flight; env `TREK_PLUGIN_RPC_BURST` /
  `_PER_SEC` / `_INFLIGHT`) throttles a runaway plugin instead of freezing the
  single-threaded host.

## Instance & ops facts

- Plugin system is **on by default**; kill switch `TREK_PLUGINS_ENABLED=false`
  (also accepts `0`/`off`/`no`). Admin UI: **Admin → Plugins** (Installed /
  Discover). **Rescan** re-reads the plugins directory and **(≥ 3.2.1)
  force-refreshes the remote registry** (bypasses the 30-min + GitHub CDN cache,
  so a just-merged plugin shows up immediately).
- **(≥ 3.2.1) Sideloading:** admins can upload a plugin `.zip`/`.tar.gz` via
  Admin → Plugins (drag-drop / Upload). It installs **inactive**, is flagged
  **Sideloaded** (`local:upload`, unsigned, unreviewed, no auto-update), and
  still needs activation + permission consent; same extract/manifest/native
  guards as a registry install; ≤ 50 MB.
- Plugin code lives in `TREK_PLUGINS_DIR` (default `<data>/plugins`), plugin
  SQLite data in `TREK_PLUGINS_DATA_DIR` (default `<data>/plugins-data`).
  Behavior-affecting operator vars: `TREK_PLUGIN_MAX_RSS_MB` (default 300),
  `TREK_PLUGIN_ALLOW_PRIVATE_EGRESS=on` (lifts the SSRF block on internal
  addresses), `TREK_PLUGIN_PERMISSIONS=off` (weakens the OS fs/child sandbox),
  `TREK_PLUGIN_REGISTRY_URL` (override registry source); **(≥3.3.0)**
  `TREK_PLUGINS_DEV_LINK=1` enables the **DEV-ONLY** dev-link workflow
  (link/reload a local build against real data — off by default, **never set in
  production**; see [references/cli.md](references/cli.md#dev-link--run-your-local-build-inside-a-real-instance-330-dev-only)),
  and the RPC-limit knobs `TREK_PLUGIN_RPC_BURST` / `_PER_SEC` / `_INFLIGHT`.
- **(≥3.3.0) Backups include plugins:** TREK backup/restore now archives each
  plugin's per-plugin SQLite data tree **and** installed code (staged and swapped
  in on next boot), so a restore no longer loses plugin state. Older archives
  without them are a no-op.
- Installed plugins must be activated one by one; a version bump that requests
  **more** permissions requires the admin to re-approve.
- Current plugin API: `apiVersion: 1` (`PLUGIN_API_VERSION`) — **not enforced at
  install** (no version negotiation). Artifact limits: 25 MB/file, 50 MB total,
  4000 zip entries.

## Canonical examples

Two official examples in the TREK repo (`plugin-sdk/examples/`) — pick the one
that matches your plugin's shape:

- **`koffi`** — the mascot hero-**widget**: manifest, membership-checked trip
  read, the iframe bridge, hand-built inline SVG UI, and a README that passes the
  CI gate. The reference for anything with its own sandboxed UI. Registry entry:
  `registry/plugins/koffi.json` in TREK-Plugins.
- **`trip-doctor`** (≥3.2.1) — a **hooks-only, no-UI** `integration`: it feeds
  TREK's own planner surfaces through `warningProvider.getWarnings` and
  `placeDetailProvider.getDetails`, and pins private notes via `ctx.meta` behind a
  `POST /pin` route. The reference for the ≥3.2.1 provider-hook + `db:meta`
  pattern — TREK renders everything natively, so there's no CSP/iframe to fight.
  (Its README's `npx @trek/plugin-sdk …` and "signed `.trekplugin` bundle" are
  example prose, **not** the real CLI — the package is `trek-plugin-sdk` and
  `pack` emits `plugin.zip`; signing is a separate `sign` step. Use the commands
  in [cli.md](references/cli.md).)

The **Plugin Cookbook** (`wiki/Plugin-Cookbook.md`, ≥3.2.1) collects copy-paste
recipes for the above plus itinerary writes, meta tagging, `ws` broadcast, and
the `trek:ui` design kit — a good first stop when you know the capability but not
the exact call.

## Reporting errors in this skill

This skill is documentation verified against TREK's source, but TREK evolves and
gaps remain. **If, while using this skill, you hit a claim here that contradicts
what the TREK source or a real TREK instance actually does — or a gap that costs
real time — do NOT just move on. Fill in the block below and hand it to the
user, ready to paste**, so it can be fixed for everyone.

Emit it verbatim in a fenced code block, every field filled from what you
actually did, then tell the user: *"Copy this and paste it into a new issue at
<https://github.com/fbnlrz/trek-plugin-skill/issues/new/choose> (pick **📋 Paste
an agent-generated report**) — it's already filled in."*

````markdown
## Skill feedback

**Type:** discrepancy | missing-guidance
**Skill file + section:** references/<file>.md → <section>
**What the skill says:** <quote the exact wording, or "n/a — not covered">
**What actually happens / what's missing:** <the correct fact or the gap>
**Evidence:** source-read | real TREK instance | trek-plugin dev | custom harness (no real CSP/sandbox) | inferred (unconfirmed)
**Citation / repro:** <TREK repo path @ commit/tag, or exact steps>
**TREK version:** <x.y.z or unknown>
**trek-plugin-sdk version:** <x.y.z or unknown>
**OS (if tooling-related):** <or n/a>
**Suggested fix (optional):** <proposed wording>

_Generated by the trek-plugin-dev skill._
````

Be **truthful in the `Evidence` field** — it is the most important line. An
inference is **not** a confirmed discrepancy; label it `inferred (unconfirmed)`
and say so out loud to the user. This is load-bearing: several reported "bugs"
have turned out to be test-method artifacts (e.g. an image failing in a bare
harness that has none of TREK's real CSP), not skill errors. Prefer to verify
against the TREK source or a real instance before claiming a discrepancy.

## Primary sources

- Wiki: [Plugin-Development](https://github.com/mauriceboe/TREK/wiki/Plugin-Development) ·
  [Plugin-Permissions](https://github.com/mauriceboe/TREK/wiki/Plugin-Permissions) ·
  [Plugin-Publishing](https://github.com/mauriceboe/TREK/wiki/Plugin-Publishing) ·
  [Plugins](https://github.com/mauriceboe/TREK/wiki/Plugins)
- Registry: [mauriceboe/TREK-Plugins](https://github.com/mauriceboe/TREK-Plugins)
  (`schema/plugin-entry.schema.json`, `schema/example-entry.json`)
- SDK: [`trek-plugin-sdk` on npm](https://www.npmjs.com/package/trek-plugin-sdk)
  (source: `plugin-sdk/` in the TREK repo)
