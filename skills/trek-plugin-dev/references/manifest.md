# `trek-plugin.json` — manifest reference

The manifest sits at the plugin root. The SDK (`trek-plugin validate`), the
registry CI, and the TREK install loader all apply the **same** rules
(`src/manifest.ts` in the SDK mirrors the server's loader).

## Fields

| Field | Type | Required | Rules / notes |
|---|---|---|---|
| `id` | string | **yes** | Lowercase slug `^[a-z][a-z0-9-]{2,39}$` (3–40 chars). Must equal the plugin directory name and, when published, the registry filename `registry/plugins/<id>.json`. Reserved: `registry`, `install`, `rescan`. |
| `name` | string | **yes** | Display name; also the nav label for `page` plugins. |
| `version` | string | **yes** | Semver `\d+.\d+.\d+` with optional pre-release (`1.2.3`, `1.2.3-beta.1`). Must equal the git tag (`v` prefix) of the release. |
| `type` | string | **yes** | `integration` \| `page` \| `widget` \| `trip-page` — `trip-page` mounts a full-frame tab inside every trip planner (scoped to the open trip), no dashboard presence. |
| `apiVersion` | number | no | Plugin API version; currently `1` (SDK constant `PLUGIN_API_VERSION`). Defaults to `1`. Must be a number, not a string. **Not enforced at install** — the server accepts any numeric value with no version negotiation. |
| `trek` | string | no | Supported TREK semver range, e.g. `">=3.2.0 <4.0.0"`. Its lower bound becomes `minTrekVersion` in the registry entry. The server does **not** gate installs on `min`/`maxTrekVersion` — advisory (registry/CI) only. |
| `author` | string | no | Shown in the store. |
| `description` | string | no | One-line store summary. **The 200-char cap binds the registry *entry*, not the manifest** — manifest parity never compares `description`, so entry and manifest may legitimately differ. But `buildEntry` copies it verbatim and `validate`/`pack` don't check length, so a > 200-char manifest description fails registry CI **after** you've cut the release. Either keep it ≤ 200 chars here, or hand-shorten the entry's `description` afterwards (allowed). Min 5 chars on the entry side. |
| `icon` | string | no | lucide-react icon name (default `Blocks`). Shown on the **Admin → Plugins** row/store card. **Note:** a page's top-nav entry uses `name` as its label but a **fixed `Blocks` icon** — the declared `icon` is *not* used for nav. |
| `homepage` | string | no | Project URL. |
| `license` | string | no | Shown in store detail; read, not enforced. |
| `nativeModules` | boolean | no | Must be `false` or absent; `true` is rejected everywhere ("native modules are not allowed (v1)"). |
| `permissions` | string[] | no | Only known permissions (below); an unknown string fails validation. |
| `egress` | string[] | conditional | Required non-empty when any `http:outbound` permission is present. No bare `"*"`. Hosts must match the host grammar (below). **Exception:** with `operatorEgress: true` an **empty `egress[]` is allowed** — see the next row. |
| `operatorEgress` | boolean | no | Defers the outbound allow-list to the operator. When `true`, an **empty `egress[]` passes validation** even though an `http:outbound*` permission is present (the normal "non-empty when `http:outbound*`" rule is waived), because the **admin adds the actual egress hosts at runtime**. Use it for plugins whose reachable hosts aren't known at authoring time (user-supplied endpoints, a self-hosted backend the admin points at). You still declare an `http:outbound` permission (validation fails without one). **Unlike `requiredAddons`/`pluginDependencies`, the SDK's `entry`/`preflight` copy `operatorEgress` into the entry automatically** — no hand-editing needed; the registry parity-checks that entry and manifest agree. |
| `requiredAddons` | string[] | no | Addon ids (`^[a-z][a-z0-9_]{1,39}$`, ≤ 16, e.g. `["budget"]`) that must be enabled in TREK. Validated by the SDK (`validateManifest`) and **enforced by TREK at activation** — a plugin whose required addon is off can't activate, and disabling the addon later cascades (`dependencies.ts`). The registry's **parity gate** requires the entry to carry the **identical** array — and the SDK's `entry` still does **not** copy it into the entry, so add it there by hand. See [publishing.md](publishing.md). |
| `pluginDependencies` | object[] | no | `{ id, version }[]` (≤ 32) — other plugins this version needs, each pinned by a semver range (`id` `^[a-z][a-z0-9-]{2,39}$`, `version` ≤ 100 chars). Same status as `requiredAddons`: **enforced at activation** (missing/mismatched dep blocks activation; registry installs auto-install declared deps; cycles rejected), parity-gated in the registry, and **not copied by `entry`** — mirror it in the entry by hand. |
| `capabilities.widget` | object | no | `{ "title": string, "slot": …, "defaultSize": … }`. Optional even for widget plugins as far as validation goes; when present, `slot` must be `sidebar` (default), `hero`, **`place-detail`**, or **`day-detail` / `reservation-detail`** — any other value is rejected. Scoped slots each mount a chrome-free panel and get an extra id in `trek:context`: `place-detail` → `placeId` (place inspector), **`day-detail` → `dayId`** (foot of the day panel), **`reservation-detail` → `reservationId`** (under each reservation/journey card). None appear on the dashboard. **Scaffold gotcha:** `create` writes `{ title, defaultSize: "medium" }` **without `slot`**, so a new widget defaults to `sidebar` — add `"slot": "hero"` yourself if you want the boarding-pass overlay. `defaultSize` is declarative only: the dashboard renders `sidebar` widgets in a **fixed ~180px, `overflow-hidden` slot** regardless, so build compact (see [server-api.md](server-api.md) / client-bridge.md). |
| `capabilities.tripPage` | object | no | For a `type:"trip-page"` plugin. `replaces: string[]` **hides** core planner tabs while the plugin is active — only these are replaceable: `transports`, `buchungen`, `listen`, `finanzplan`, `dateien`, `collab` (the **`plan` tab can never be replaced**; an unlisted value throws at install). `position: number` sets the plugin tab's preferred 0-based index (integer 0–50; omitted = appended after core tabs). This is the mechanism for a full **tab-takeover** trip-page. |
| `capabilities.provides` | string[] | no | Callable export names this plugin exposes to its **dependents** via `ctx.plugins.call` (safe identifiers, de-duplicated + name-validated at install). The counterpart to `pluginDependencies` (the consuming side). |
| `capabilities.emits` | string[] | no | Event names this plugin publishes to dependents via `ctx.events.emit` (dotted names like `rate.updated` allowed). Drives the host's `subscribersOf` routing. |
| `settings` | array | no | Settings fields (below). Declared here; **the SDK validator and CI do not validate `settings[]`** — the runtime host renders/enforces them. Plugins write no settings UI. |
| `actions` | object[] | no | Up to **8 settings-page buttons** ("Test connection"-style). Each renders on the plugin's user-settings page and runs **user-bound** via `POST /api/plugin-settings/<id>/action`; the handler's result is normalized to `{ ok, message }` (message emoji-stripped, ≤ 200 chars). Test with the mock host's `declaredActions` + driver `action(key)` — see [testing.md](testing.md). |
| `capabilities.notificationChannel` | object | no | Declares an `integration` as a **notification delivery channel** — `{ title?: string, events: [...] }`. Each event must be one of the **10 plugin-deliverable** events (`trip_invite`, `booking_change`, `trip_reminder`, `todo_due`, `vacay_invite`, `collection_invite`, `photos_shared`, `collab_message`, `packing_tagged`, `plugin_notification`) — admin-scoped/in-app-only events are excluded. **Requires the `hook:notification-channel` permission** (validation fails without it) and a `hooks.notificationChannel` implementation; `create` ships a `notification-channel` template. See [server-api.md](server-api.md). |

**Declarative-only keys the scaffold writes but the installed-manifest parser
does not consume:** `routes[]` (real routes come from the loaded `definePlugin`
object) and `capabilities.nav` (a page's nav entry uses top-level `name` as its
label; the icon is a fixed `Blocks` glyph, not the manifest `icon`).

## Permissions catalog (complete)

| Permission | Grants | Notes |
|---|---|---|
| `db:own` | `ctx.db.query` / `exec` / `migrate` on the plugin's **own** SQLite file | Never `trek.db`. `migrate(id, sql)` is keyed + idempotent. Refused SQL: `ATTACH`/`DETACH`/`VACUUM`/`PRAGMA`/**`RECURSIVE`**. Caps: DB ≤ **256 MB**, `query` ≤ **100 000 rows**, SQL ≤ **100 000 chars**. |
| `db:read:trips` | `ctx.trips.getById` / `getPlaces` / `getReservations` (read-only) | Membership-checked against the acting user; **route handlers only**. |
| `db:read:users` | `ctx.users.getById` | **Route handlers only** (needs acting user). Returns only the **acting user or a trip co-member** (id, username, display_name, avatar) — not a free lookup of any account; others → `RESOURCE_FORBIDDEN`. |
| `db:read:costs` | `ctx.costs.getByTrip` / `listMine` (read-only budget items) | "Costs" = budget items. **Route handlers only** (acting user); `getByTrip` is membership-checked, `listMine` aggregates every accessible trip. Also requires the **Costs (budget) addon enabled**, else `RESOURCE_FORBIDDEN` ("the costs addon is disabled"). |
| `db:read:packing` | `ctx.packing.list(tripId)` — a trip's packing items (hydrated bags/assignees) | **Route handlers only** (acting user); membership-checked. Scoped to the acting user's visibility — a plugin **never** sees another member's private (`is_private`) items. Separate scope from `files`. |
| `db:read:files` | `ctx.files.list(tripId)` — a trip's files (trash excluded) | **Route handlers only** (acting user); membership-checked. Separate scope (packing doesn't unlock files). |
| `db:read:files:content` | `ctx.files.getContent(tripId, fileId)` — raw file bytes | **Distinct grant from `db:read:files`** — listing files does *not* let you read their contents. Returns `{name, mimetype, size, content_base64}`; 10 MB cap, trashed files refused. Route handlers only. |
| `db:read:collab` | `ctx.collab.listNotes` / `listPolls` / `listMessages` | Collab addon required. Route handlers only (membership-checked). |
| `db:read:journal` | `ctx.journal.listMine` / `getEntries` | Journey addon required. Acting-user scoped. |
| `db:read:atlas` | `ctx.atlas.visited` / `bucketList` | Atlas addon required. The acting user's own visited/bucket data. |
| `db:read:vacay` | `ctx.vacay.mine` | Vacay addon required. The acting user's own entries. |
| `db:read:daynotes` | `ctx.daynotes.list(tripId, dayId)` | Route handlers only (membership-checked). |
| `db:read:collections` | `ctx.collections.listMine` / `get` | Collections addon required. Acting-user scoped. |
| `db:read:categories` | `ctx.categories.list()` — the global place-category reference | Read-only reference data; no trip scope. |
| `db:read:tags` | `ctx.tags.list()` — the acting user's own tags | Acting-user scoped. |
| `db:read:todos` | `ctx.todos.list(tripId)` | Route handlers only (membership-checked). |
| `db:write:costs` | `ctx.costs.create` / `update` / `delete` (budget items) | **Route handlers only.** Needs the Costs addon enabled **+** trip access **+** the acting user's **`budget_edit`** (else `RESOURCE_FORBIDDEN`). Input zod-validated (→ `BAD_PARAMS`); broadcasts `budget:created/updated/deleted`. |
| `db:write:places` | `ctx.places.create` / `update` / `delete` | **Route handlers only.** Trip access **+** the acting user's **`place_edit`**. Input zod-validated (`name` required → `BAD_PARAMS`) and length-capped like the web app (name ≤ 200, description ≤ 2000, address ≤ 500, notes ≤ 2000 → `BAD_PARAMS`); broadcasts `place:created/updated/deleted`; audited. |
| `db:write:days` | `ctx.days.create` / `update` / `delete` | **Route handlers only.** Trip access **+** **`day_edit`**. Broadcasts `day:created/updated/deleted`. |
| `db:write:itinerary` | `ctx.itinerary.assign` / `unassign` (place↔day) | **Route handlers only.** Trip access **+** **`day_edit`**. The day and place must both belong to the trip (cross-trip link → `RESOURCE_FORBIDDEN`). Broadcasts `assignment:created/deleted`. |
| `db:write:trips` | `ctx.trips.update` (edit trip fields) | **Route handlers only.** Trip access **+** **`trip_edit`**. Only schema-writable fields; setting `is_archived` also needs **`trip_archive`**, `cover_image` needs **`trip_cover_upload`**. Broadcasts `trip:updated`. |
| `db:create:trips` | `ctx.trips.create(input)` | **Route handlers only.** Acting user's **`trip_create`**; `title` required. Creates a new trip owned by the acting user. |
| `db:write:members` | `ctx.trips.addMember` / `removeMember` | **Route handlers only.** Trip access **+** **`member_manage`**. ⚠️ `addMember` **grants a user access to the trip** — treat it as privileged. Can't remove the trip owner. |
| `db:write:reservations` | `ctx.reservations.create` / `update` / `delete` | **Route handlers only.** Trip access **+** **`reservation_edit`**. `create`/`update` persist an `endpoints` array (from/to/stop legs): omitted = keep, `[]` = delete all, array = replace. |
| `db:write:accommodations` | `ctx.accommodations.create` / `update` / `delete` | **Route handlers only.** Trip access **+** **`day_edit`**. Creating one **auto-creates the partner hotel reservation**, like the app. |
| `db:write:packing` | `ctx.packing.create` / `update` / `delete` **and all bag methods** (`listBags` / `createBag` / `updateBag` / `deleteBag` / `setBagMembers`) | **Route handlers only.** Trip access **+** **`packing_edit`**. ⚠️ **Surprising grouping:** `db:read:packing` only unlocks `packing.list`; **every bag method (incl. `listBags`) needs `db:write:packing`.** `create` shape: `{name, category?, checked?, is_private?, visibility?:'common'\|'personal'\|'shared', recipient_ids?}`. |
| `db:write:collab` | `ctx.collab.createNote` / `createPoll` / `votePoll` / `createMessage` | **Route handlers only.** Collab addon **+** trip access **+** **`collab_edit`**. |
| `db:write:atlas` | `ctx.atlas.markCountry` / `unmarkCountry` / `markRegion` / `unmarkRegion` / `createBucketItem` / `deleteBucketItem` | Atlas addon. Affects the **acting user's own** atlas data. |
| `db:write:vacay` | `ctx.vacay.toggleEntry(date)` / `toggleCompanyHoliday(date, note?)` | Vacay addon. Acting user's own entries. |
| `db:write:journal` | `ctx.journal.createEntry` / `updateEntry` / `deleteEntry` / `createJourney` / `deleteJourney` | Journey addon. Acting-user/contributor gated. |
| `db:write:collections` | `ctx.collections.create` / `update` / `savePlace` / `copyToTrip` / `deletePlace` | Collections addon. Acting-user scoped. |
| `db:write:daynotes` | `ctx.daynotes.create` / `update` / `delete` | **Route handlers only.** Trip access **+** **`day_edit`** (daynote writes ride on `day_edit`). |
| `db:write:tags` | `ctx.tags.create` / `update` / `delete` | The acting user's own tags. |
| `db:write:todos` | `ctx.todos.create` / `update` / `delete` | **Route handlers only.** Trip access **+** **`packing_edit`** (todo writes ride on `packing_edit`). |
| `db:meta` | `ctx.meta.get`/`set`/`list`/`delete` — the plugin's **own** namespaced key/value store on a `trip`/`place`/`day` — **and `reservation`/`accommodation`** | **Route handlers only.** Reads need trip access; writes need the entity's edit permission. Per-plugin namespace (you see only your own rows). Quotas: key ≤ 256 chars, value ≤ 64 KB JSON, ≤ 100 keys per entity (over → `BAD_PARAMS`). Enrich core entities without forking the schema. |
| `ws:broadcast:trip` | `ctx.ws.broadcastToTrip` | **Route handlers only**; acting user must be a trip member. Event `plugin:<id>:<event>` to the **core app's** trip clients — **not** your own iframe. |
| `ws:broadcast:user` | `ctx.ws.broadcastToUser` | **Route handlers only**; target must equal the acting user (own connections only). Event `{ type: 'plugin:<id>', event }`. There is **no** `ws:broadcast:*`. |
| `events:subscribe` | React to core activity via `events: [{ on, handler }]` on the **definition** (not a route) | **Wired.** Core announces every trip event (e.g. `place:created`, `day:updated`, `file:created`, or `*`) to subscribed, granted, active plugins. Handler gets **only `{ event, tripId }`** (never the payload) and runs with **no user** (like a job → trip reads refused; use `ctx.db`/`ctx.ws`/outbound). Fire-and-forget on a ~5 s timeout — a slow subscriber never blocks a core write. Your own `plugin:*` broadcasts are never re-delivered, so handlers can't loop. |
| `hook:photo-provider` | `hooks.photoProvider` | **Wired** (`plugin-photos.controller.ts` consumes it). |
| `hook:calendar-source` | `hooks.calendarSource` | **Wired** (`plugin-calendar.controller.ts`). `getEvents(userId, start, end)` — `start`/`end` are ISO **strings**. |
| `hook:place-detail-provider` | `hooks.placeDetailProvider.getDetails(placeId, ctx)` → `{ label, value?, url? }[]` | **Wired.** Core calls every active implementer to enrich a place's detail panel (additive, fail-safe). Server-side, no UI of its own. |
| `hook:trip-warning-provider` | `hooks.warningProvider.getWarnings(tripId, ctx)` → `{ level, message, dayId?, placeId? }[]` | **Wired.** TREK surfaces the returned warnings in the trip planner (`level` = `info`/`warning`/`error`). |
| `hook:table-contributor` | `hooks.tableContributor` | **Wired.** Contributes columns/actions to core table views (reservations/places/day/costs/packing/files). Declarative shape, host-sanitized (emoji-stripped), fail-safe. |
| `hook:map-marker-provider` | `hooks.mapMarkerProvider` | **Wired.** Contributes markers to the trip map (labels emoji-stripped). |
| `hook:pdf-section-provider` | `hooks.pdfSectionProvider` | **Wired.** Adds sections to the exported trip PDF. |
| `hook:atlas-layer-provider` | `hooks.atlasLayerProvider` | **Wired.** Adds labelled layers to the atlas. |
| `hook:journal-entry-provider` | `hooks.journalEntryProvider` | **Wired.** Contributes rows to journal entries. |
| `hook:trip-card-provider` | `hooks.tripCardProvider` | **Wired.** Adds badges/content to dashboard trip cards. |
| `hook:user-data` | definition-level `deleteUserData(userId)` / `exportUserData(userId)` | **Wired, GDPR.** Host calls these durably on account erasure/export. **Userless** — you get only a `userId` and act on your **own `db:own`** data; grants **no** core read. Implement it if you store personal data. |
| `hook:notification-channel` | `hooks.notificationChannel` — deliver TREK notifications through your own channel (Telegram, Gotify, …) | **Wired.** Requires `capabilities.notificationChannel.events`. The hook runs **USERLESS**, with the recipient's decrypted per-user settings passed as its config — so a channel plugin works for every user who configured it. |
| `ai:invoke` | `ctx.ai.complete` / `ctx.ai.extract` | **Broker.** Host-brokered LLM using the **acting user's** configured provider — the plugin never holds a key. 20 000-char cap; output is **data-only**. |
| `notify:send` | `ctx.notify.send` | **Broker.** Recipient **forced** to the acting user or a trip they're in (admin scope refused); emoji-stripped; `title` ≤ 200 / `body` ≤ 1000; `link` must be an in-app `/…` path. |
| `oauth:client` | `ctx.oauth.getAccessToken()` | **Broker.** Short-lived token for a service the user connected via **Settings → Plugins → Connect**; the plugin never sees the secret. `null` when userless/unconnected. |
| `rates:read` | `ctx.rates.get` | **Broker.** Currency exchange rates. Tenant-free (no acting user needed). |
| `weather:read` | `ctx.weather.get` | **Broker.** Weather by coordinates (host-cached). Tenant-free. |
| `jobs:run` | Declared cron `jobs[]` **and** `ctx.scheduler.set` / `cancel` | **Opt-in gate** for background execution. Covers both node-cron-scheduled declared jobs *and* the persistent `ctx.scheduler`. Callbacks run **userless** (trip reads refused) — see [server-api.md](server-api.md). |
| `http:outbound` | Marker: plugin does outbound HTTP | Satisfies the "egress required" rule but grants **no host** by itself. |
| `http:outbound:<host>` | Opens `<host>` in the runtime egress guard **and** the iframe CSP `connect-src` | This is what actually allows a request. |

> **~50 grants, two special families.** The **broker
> permissions** (`ai:invoke` / `notify:send` / `oauth:client` / `rates:read` /
> `weather:read` / `jobs:run`) are host services, not DB scopes — `rates`/
> `weather`/`ai` are tenant-free while `notify`/`oauth` are acting-user-scoped;
> and the **provider hooks** let an `integration` inject native UI (map
> markers, PDF sections, atlas layers, journal rows, trip-card badges, table
> columns) with no iframe of its own.

### The egress trap (most common runtime bug)

Both network guards (runtime egress guard in the child process, CSP
`connect-src` in the iframe) are built **from the `http:outbound:<host>`
permissions — not from `egress[]`**. The validator only checks `egress[]` for
presence, non-emptiness, no bare `*`, and per-host grammar; it never
cross-checks the two lists.

Consequence: a host in `egress[]` without a matching `http:outbound:<host>`
permission passes validation and install, then every request to it is refused
at runtime with no manifest error. **Rule: list every host you call as *both*
an `http:outbound:<host>` permission *and* an `egress[]` entry, identical.**

**Exception — operator-managed egress:** set top-level
`operatorEgress: true` and the non-empty-`egress[]` requirement is **waived** —
you can ship an **empty `egress[]`** (with just the bare `http:outbound` marker)
and the **operator adds the allowed hosts at runtime**; those admin-configured
hosts drive the guard. This is the sanctioned path for a plugin whose hosts an
admin supplies after install (self-hosted Gotify/ntfy, user-entered endpoints) —
`entry`/`preflight` copy `operatorEgress` into the entry for you and the registry
parity-checks it, so no hand-editing. Use it only when you genuinely can't know
the hosts up front. Otherwise the static
`http:outbound:<host>` + `egress[]` pairing above is clearer and needs no admin
step.

Host grammar (both places): exact hostname (`api.example.com`) or wildcard
`*.suffix` with a multi-label suffix (`*.example.com` — matches apex and
subdomains). Rejected: bare `*`, `*.`, whole-TLD wildcards like `*.com`,
spaces. Even an allow-listed host is refused if it resolves to a
loopback/private/link-local/metadata address (SSRF backstop).

## Settings fields (`settings[]`)

| Key | Notes |
|---|---|
| `key` | **Required** identifier; entries with an empty key are dropped. |
| `label` | Form label. |
| `input_type` | **snake_case**: `text` (default), `password`, `number`, `select`, … Rendered by the host's settings form (Admin → Plugins for `instance` scope; the user's plugin settings for `user` scope). |
| `scope` | `instance` (default — set once by admin) or `user` (per-user). |
| `required` | boolean. |
| `secret` | boolean — encrypted at rest, decrypted only into server-side `ctx.config`, never sent to the iframe. |
| `placeholder`, `hint` | Form hints. |
| `options` | `[{ "value": …, "label": … }]` for `select`. |
| `oauth` | `{ "initPath": …, "callbackPath": … }` — **descriptive metadata only**; the host doesn't mount or drive it. For a **host-brokered** flow, don't use this: declare the five magic `scope:'instance'` settings instead (`oauth_authorize_url`, `oauth_token_url`, `oauth_scopes`, `oauth_client_id`, `oauth_client_secret`) and read tokens via `ctx.oauth.getAccessToken()` — see [server-api.md](server-api.md). Self-managed flows use your own routes (an `auth:false` callback, relative in-app redirect). |

Resolved **instance-scoped** values arrive in `ctx.config` — decrypted and
**frozen at activation** (not per-user, not hot-reloaded; a change needs
deactivate→activate). `scope: user` settings are **not** surfaced to server
`ctx.config` — read per-user values via
**`ctx.settings.get(key)`** — the *acting user's* own decrypted value for a
`scope:'user'` field; returns `undefined` when unset or in a userless
(job/`onLoad`) context, where you fall back to `ctx.config`. See
[server-api.md](server-api.md).

## Example: minimal widget with network access

```json
{
  "id": "flight-tracker",
  "name": "Flight Tracker",
  "version": "1.0.0",
  "apiVersion": 1,
  "type": "widget",
  "trek": ">=3.2.0 <4.0.0",
  "author": "You",
  "description": "Live flight status on the dashboard.",
  "icon": "Plane",
  "license": "MIT",
  "nativeModules": false,
  "permissions": [
    "db:own",
    "db:read:trips",
    "http:outbound",
    "http:outbound:api.aviationstack.com"
  ],
  "egress": ["api.aviationstack.com"],
  "capabilities": {
    "widget": { "title": "Flights", "slot": "sidebar" }
  },
  "settings": [
    { "key": "api_key", "label": "API key", "input_type": "password",
      "scope": "instance", "required": true, "secret": true }
  ]
}
```

## Real-world example: koffi (official mascot widget)

```json
{
  "id": "koffi",
  "name": "Koffi",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "TREK",
  "description": "Koffi, the tiny suitcase mascot, lives on your boarding pass — strolling, rolling, collecting stickers, and getting more excited the closer your trip gets.",
  "homepage": "https://github.com/mauriceboe/trek-plugin-koffi",
  "license": "MIT",
  "icon": "Luggage",
  "type": "widget",
  "trek": ">=3.2.0 <4.0.0",
  "nativeModules": false,
  "permissions": ["db:read:trips"],
  "capabilities": {
    "widget": { "title": "Koffi", "slot": "hero" }
  },
  "routes": [
    { "method": "GET", "path": "/state", "auth": true }
  ]
}
```

(The `routes` block here is documentation for readers — the host derives real
routes from the loaded plugin definition.)
