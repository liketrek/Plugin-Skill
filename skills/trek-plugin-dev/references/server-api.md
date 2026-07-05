# Server API — `definePlugin` and the `ctx` object

The server entry is `server/index.js` at the plugin root: **built, plain
CommonJS** (`package.json` has `"type": "commonjs"`). It exports the object
returned by `definePlugin(...)`. The host loads it in an isolated child
process; everything reaches TREK through the `ctx` argument over RPC.

```js
const { definePlugin } = require('trek-plugin-sdk')   // injected at runtime — devDependency only!

module.exports = definePlugin({
  // Runs once on activation. NO acting user here: ctx.trips/users/ws are refused.
  // Must finish within 30s or activation fails and the child is killed.
  async onLoad(ctx) {
    await ctx.db.migrate('001_init',
      'CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT)')
    ctx.log.info('loaded')
  },

  // Runs once on deactivation/stop — flush or release resources.
  async onUnload(ctx) { ctx.log.info('unloading') },

  // HTTP routes, mounted at /api/plugins/<id><path>. Exact-path match, 30s timeout.
  routes: [
    { method: 'GET', path: '/status', auth: true,
      async handler(req, ctx) {
        const rows = await ctx.db.query('SELECT COUNT(*) AS n FROM cache')
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ n: rows[0].n, user: req.user?.username }),
        }
      } },
  ],

  // Cron jobs — DECLARED but NOT run by the server in TREK 3.2.0/3.2.1 (see below).
  jobs: [
    { id: 'refresh', schedule: '*/15 * * * *', async handler(ctx) { /* … */ } },
  ],
})
```

The routes and job ids on the **loaded definition are authoritative** (a
route's array index is its internal id); the `routes` block in the manifest is
never consumed.

> ⚠️ **`jobs[]` are not scheduled in TREK 3.2.0 / 3.2.1.** The child *can* handle
> an `invoke.job`, but **nothing in the server ever sends one** — there is no
> cron runner wiring plugin jobs (`plugins.module.ts`, `scheduler.ts` schedule
> only core tasks; the sole `invoke.job` reference is the child handler in
> `runtime/plugin-host-entry.ts`). A declared `schedule` is parsed and reported
> but the handler **never fires**. Do **not** rely on `jobs` for periodic work:
> drive it from a route your own client polls, or an external trigger hitting an
> `auth:false` route. (The Plugin Cookbook's "Where things run" table lists
> `jobs` as running "on a schedule" — that row is aspirational; no scheduler
> wiring exists in 3.2.0/3.2.1, verified above.)

## Type surface (from `trek-plugin-sdk`)

```ts
export const PLUGIN_API_VERSION = 1;

export interface PluginDefinition {
  onLoad?(ctx: PluginContext): Promise<void> | void;
  onUnload?(ctx: PluginContext): Promise<void> | void;
  routes?: PluginRoute[];
  jobs?: PluginJob[];               // declared but not scheduled (see above)
  events?: PluginEventSubscription[]; // (≥3.2.1) WIRED reactive hook — needs events:subscribe
  hooks?: {                                    // ≥3.2.1: placeDetail + warning are WIRED
    photoProvider?: PhotoProvider;             // reserved — not consumed
    calendarSource?: CalendarSource;           // reserved — not consumed
    placeDetailProvider?: PlaceDetailProvider; // (≥3.2.1) getDetails(placeId, ctx) → {label,value?,url?}[]
    warningProvider?: WarningProvider;         // (≥3.2.1) getWarnings(tripId, ctx) → {level,message,dayId?,placeId?}[]
  };
}

// (≥3.2.1) core-event subscription — see "Event subscriptions" below
export interface PluginEventSubscription {
  on: string;   // 'place:created' | 'day:updated' | 'file:created' | … | '*'
  handler(payload: { event: string; tripId: number }, ctx: PluginContext): Promise<void> | void;
}

export interface PluginRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;                     // matched EXACTLY (no :params, no wildcards)
  auth?: boolean;                   // default true; false for OAuth callbacks/webhooks
  handler(req: PluginRequest, ctx: PluginContext): Promise<PluginResponse>;
}

export interface PluginRequest {
  method: string; path: string;
  query: Record<string, unknown>; body: unknown;
  user: { id: number; username: string; isAdmin: boolean } | null;
}
export interface PluginResponse { status: number; headers?: Record<string, string>; body?: unknown; }

export interface PluginContext {
  readonly id: string;
  readonly config: Readonly<Record<string, unknown>>;    // instance-scoped, frozen at activation
  db: {
    query<T = unknown>(sql: string, ...args: unknown[]): Promise<T[]>;
    exec(sql: string, ...args: unknown[]): Promise<{ changes: number }>;
    migrate(id: string, sql: string): Promise<{ applied: boolean }>;
  };
  // (≥3.2.1) reads return typed entities (Trip/Place/Day/Reservation/PackingItem/
  // TripFile/BudgetItem/Assignment/User) — but only `id` is guaranteed; every shape
  // keeps an index signature and mirrors the raw DB row, so treat other fields as
  // optional. `unknown`-typed on ≤3.2.0.
  trips: {
    getById(tripId, asUserId?): Promise<Trip | null>; getPlaces(...): Promise<Place[]>; getReservations(...): Promise<Reservation[]>;
    update(tripId: number, input: Record<string, unknown>): Promise<Trip>;      // (≥3.2.1)
  };
  packing: { list(tripId: number): Promise<PackingItem[]> };  // (≥3.2.1) db:read:packing
  files:   { list(tripId: number): Promise<TripFile[]> };     // (≥3.2.1) db:read:files
  costs: {                                               // (≥3.2.1) budget items
    getByTrip(tripId: number): Promise<unknown[]>;
    listMine(): Promise<unknown[]>;
    create(tripId: number, input: Record<string, unknown>): Promise<unknown>;
    update(tripId: number, itemId: number, input: Record<string, unknown>): Promise<unknown>;
    delete(tripId: number, itemId: number): Promise<{ deleted: boolean }>;
  };
  // (≥3.2.1) permission-gated trip-planner writes
  places: { create(tripId, input); update(tripId, placeId, input); delete(tripId, placeId): Promise<{ deleted: boolean }> };
  days:   { create(tripId, input); update(tripId, dayId, input); delete(tripId, dayId): Promise<{ deleted: boolean }> };
  // days.create takes { date?, notes?, position? } — a `title` is DROPPED here; set it via days.update.
  itinerary: { assign(tripId, dayId, placeId, notes?); unassign(tripId, assignmentId): Promise<{ deleted: boolean }> };
  meta: {                                                // (≥3.2.1) plugin-private KV on core entities
    get(entityType: 'trip' | 'place' | 'day', entityId: number, key: string): Promise<unknown>;
    set(entityType, entityId, key, value): Promise<{ key: string; value: unknown }>;
    list(entityType, entityId): Promise<Record<string, unknown>>;
    delete(entityType, entityId, key): Promise<{ deleted: boolean }>;
  };
  users: { getById(id: number): Promise<unknown> };
  ws: {
    broadcastToTrip(tripId: number, event: string, data): Promise<void>;
    broadcastToUser(userId: number, event: string, data): Promise<void>;
  };
  log: { info(msg, meta?): void; warn(msg, meta?): void; error(msg, meta?): void };
}
```

## `ctx` semantics and required permissions

| Area | Behavior | Requires |
|---|---|---|
| `ctx.db` | Your **own** SQLite file (never `trek.db`). `migrate(id, sql)` runs a keyed, idempotent migration once per id. Refused SQL: `ATTACH` / `DETACH` / `VACUUM` / `PRAGMA` / **`RECURSIVE`**. **Caps:** DB ≤ **256 MB** (further writes fail `SQLITE_FULL`), a single `query` returns ≤ **100 000 rows**, SQL text ≤ **100 000 chars**. | `db:own` |
| `ctx.trips` | Read-only; **route handlers only**. The host binds the acting user from the request and membership-checks every read. `asUserId` is **ignored** (can't impersonate). From `onLoad`/`jobs` (no user) → `RESOURCE_FORBIDDEN`. | `db:read:trips` |
| `ctx.users.getById` | **Route handlers only** (needs acting user). Returns **only the acting user themselves or a user who co-members a trip with them** (`id, username, display_name, avatar`) — **not** a free lookup of any account by id; others → `RESOURCE_FORBIDDEN`. | `db:read:users` |
| `ctx.packing.list(tripId)` **(≥3.2.1)** | **Route handlers only** (host-bound acting user; `onLoad`/jobs → `RESOURCE_FORBIDDEN`). A trip's packing items with bags/assignees hydrated, **scoped to what the acting user may see** — another member's private items are filtered out (same as the app). Separate scope from `files`. | `db:read:packing` |
| `ctx.files.list(tripId)` **(≥3.2.1)** | **Route handlers only** (acting user; membership-checked). A trip's files with **trash excluded** — the same view the files tab shows. | `db:read:files` |
| `ctx.costs.getByTrip` / `listMine` **(≥3.2.1)** | "Costs" = budget items. **Route handlers only** (host-bound acting user; `onLoad`/jobs → `RESOURCE_FORBIDDEN`). `getByTrip` membership-checks the trip; `listMine` returns items across every trip the user can access. Requires the **Costs addon enabled** (else `RESOURCE_FORBIDDEN`: "the costs addon is disabled"). | `db:read:costs` |
| `ctx.costs.create` / `update(tripId, itemId, input)` / `delete(tripId, itemId)` **(≥3.2.1)** | **Route handlers only.** Create/edit/remove budget items (frozen FX + members/payers); **broadcasts `budget:created/updated/deleted`**. Requires the Costs addon **+** trip access **+** the acting user's **`budget_edit`**; input zod-validated (→ `BAD_PARAMS`). | `db:write:costs` |
| `ctx.trips.update(tripId, input)` **(≥3.2.1)** | **Route handlers only.** Edit trip fields (`title`/`start_date`/`end_date`/`currency`/`reminder_days`/…). Trip access **+** the acting user's **`trip_edit`**; setting `is_archived` also needs **`trip_archive`**, `cover_image` needs **`trip_cover_upload`**. zod-validated (→ `BAD_PARAMS`); broadcasts `trip:updated`. | `db:write:trips` |
| `ctx.places.*` / `ctx.days.*` / `ctx.itinerary.*` **(≥3.2.1)** | **Route handlers only.** Create/update/delete planner places & days; assign/unassign places to days. Trip access **+** the matching edit permission (`place_edit` / `day_edit` / `day_edit`); the day & place must belong to the trip. zod-validated (→ `BAD_PARAMS`); each broadcasts the app's real event (`place:*` / `day:*` / `assignment:*`) and is audited. | `db:write:places` / `db:write:days` / `db:write:itinerary` |
| `ctx.meta.*` **(≥3.2.1)** | **Route handlers only.** The plugin's **own** namespaced KV store on a `trip`/`place`/`day` (`get`/`set`/`list`/`delete`). Reads need trip access; writes need the entity's edit permission. Per-plugin namespace; quotas key ≤ 256 chars / value ≤ 64 KB JSON / ≤ 100 keys per entity (over → `BAD_PARAMS`). Enrich core entities without forking the schema. | `db:meta` |
| `ctx.ws.broadcastToTrip` | **Route handlers only.** The acting user must be a member of the target trip. Event to the **core TREK app's** trip-room clients as `plugin:<id>:<event>`. | `ws:broadcast:trip` |
| `ctx.ws.broadcastToUser` | **Route handlers only.** Target **must equal the acting user** (`userId === req.user.id`) — you can only push to the acting user's **own** connections. Event to core clients as `{ type: 'plugin:<id>', event, ...data }`. | `ws:broadcast:user` |
| `ctx.config` | **Instance-scoped** settings, decrypted and **frozen at activation** (`secret:true` arrive decrypted, server-side only). Not per-user; not hot-reloaded — change requires deactivate→activate. `scope:user` settings are **not** surfaced here in 3.2.0. | — |
| `ctx.log` | `info`/`warn`/`error` → the plugin's error log in Admin → Plugins. | — |
| `ctx.id` | Your plugin id (also in `process.env.TREK_PLUGIN_ID`). | — |

> **`ctx.ws.broadcast*` never reaches your own plugin UI.** Broadcasts go to the
> **core TREK app's** WebSocket clients; there is no path forwarding
> `plugin:<id>:*` events into your sandboxed iframe (the frame can't open the
> credentialed `/ws`, and the bridge only relays `trek:context`/`trek:response`/
> `trek:error`). For your widget/page to reflect live state, **poll your own
> route via `trek:invoke`**. `ws:broadcast:*` is only useful to drive parts of
> TREK that explicitly consume the event.

## Provider hooks (≥3.2.1)

Besides `routes`, a plugin (typically an `integration`) can contribute to core
TREK via **wired** `hooks` on the definition — each gated by a `hook:*`
permission and called with the plugin `ctx`:

- **`placeDetailProvider`** (`hook:place-detail-provider`) —
  `getDetails(placeId, ctx): Promise<{ label: string; value?: string; url?: string }[]>`.
  Core calls **every active implementer** and shows the items in a place's detail
  panel. Additive & **fail-safe** — a throw/timeout is skipped, never fatal.
- **`warningProvider`** (`hook:trip-warning-provider`) —
  `getWarnings(tripId, ctx): Promise<{ level: 'info'|'warning'|'error'; message: string; dayId?: number; placeId?: number }[]>`.
  TREK surfaces the returned warnings in the trip planner.

The `hook:*` grant is **enforced at dispatch** (v3-2-1): core only wires a
provider that is active, implements the hook in code, **and** holds the matching
`hook:*` permission. Declaring `getDetails`/`getWarnings` without the grant means
your hook is silently never called — so if a provider "never fires", check the
manifest `permissions` first.

`photoProvider` / `calendarSource` still validate but are **not** consumed
(`CalendarSource.getEvents(userId, start, end)` now takes `start`/`end` as ISO
**strings**, not `Date` — the host↔plugin boundary is JSON). Hooks feed **core
UI** without your own iframe; the `place-detail` **widget slot** is the other
route (your own sandboxed panel — see [client-bridge.md](client-bridge.md)).

## Event subscriptions (≥3.2.1)

This is the **working reactive mechanism** — the one `jobs` never became. Declare
`events` on the definition (alongside `routes`/`hooks`) plus the `events:subscribe`
grant, and core fans out every trip event to you:

```js
module.exports = definePlugin({
  events: [
    { on: 'file:created', async handler({ event, tripId }, ctx) {
        await fetch('https://hooks.example.com/notify', { method: 'POST', /* needs http:outbound */
          body: JSON.stringify({ event, tripId }) });
    } },
    // { on: '*', handler }  // subscribe to everything
  ],
});
```

- **`on`** is a core event name (`place:created`, `place:updated`, `day:updated`,
  `file:created`, `assignment:created`, `budget:updated`, …) or `'*'` for all.
- The handler receives **only `{ event, tripId }`** — *never the payload* — and runs
  with **no user** (like a job): `ctx.trips`/`packing`/`files`/`costs`/`meta` reads
  → `RESOURCE_FORBIDDEN`. React with `ctx.db`, `ctx.ws.*`, or an outbound call.
- **Fire-and-forget, ~5 s timeout, best-effort:** a slow or throwing subscriber is
  dropped and can never block or fail a core write.
- Your own `plugin:<id>:*` broadcasts are **not** re-delivered, so a handler that
  broadcasts can't loop back into itself.
- The grant is enforced host-side: an active plugin that implements `events` but
  lacks `events:subscribe` is silently never called.

## Error codes

Seven codes cross RPC (`protocol/envelope.ts`): `PERMISSION_DENIED` (permission
not granted), `UNKNOWN_METHOD` (no such host method), `BAD_PARAMS` (wrong
argument type, e.g. non-numeric `tripId`), `RESOURCE_FORBIDDEN` (no acting user
/ membership check failed), `TIMEOUT`, `PLUGIN_ERROR` (your handler threw →
surfaces to the browser as **HTTP 502**), `HOST_ERROR` (host-side failure). A
failed `ctx.*` call rejects with a JS `Error` whose **message is prefixed by the
code**, e.g. `"PERMISSION_DENIED: …"` — catch and match on that.

## Routes

- Mounted at **`/api/plugins/<id><path>`** (dev server: `/api/<path>`). Matched
  by **exact method + exact path** — no `:params`, no wildcards. Unknown route
  or inactive plugin → **404**; missing auth on an `auth:true` route → **401**.
- `auth: true` (default): `req.user` is the logged-in user. `auth: false` for
  OAuth callbacks / webhooks.
- The proxy forwards only `{ method, path, query, body, user }` — no raw headers,
  no session cookie.
- **Response constraints:** of your `headers`, only **`content-type` and
  `cache-control`** pass through (everything else — incl. `set-cookie`, custom
  headers — is dropped). Every reply is forced `X-Content-Type-Options: nosniff`
  and `Content-Disposition: attachment` (it can never render as a document at
  TREK's origin). A **3xx** is honored **only if `location` is a relative in-app
  path** (`^/…`, not `//…`) — otherwise **502** (matters for OAuth callbacks).
  Serialize JSON yourself.
- Each route invocation has a **30 s** timeout (→ 502).

## OAuth / settings caveats

- `settings[].oauth = { initPath, callbackPath }` is **descriptive metadata
  only** — the host stores it but does not mount or drive it (like manifest
  `routes[]`). Implement the flow yourself with your own routes: an `auth:false`
  callback whose redirect is a relative in-app path (see Routes).
- Version compatibility is **not enforced at install**: the server accepts any
  numeric `apiVersion` (never compared to `PLUGIN_API_VERSION`) and does not gate
  on `trek`/`minTrekVersion`/`maxTrekVersion` — those are advisory (registry/CI
  only). An incompatible plugin still installs and simply fails at runtime.

## Outbound HTTP

Use the global `fetch` (Node ≥ 18). Every request passes the runtime egress
guard: only hosts granted as `http:outbound:<host>` (exact or `*.suffix`) are
reachable; private/loopback/link-local/metadata addresses are refused (SSRF
backstop) **unless** the operator sets `TREK_PLUGIN_ALLOW_PRIVATE_EGRESS=on`.
See the egress trap in [manifest.md](manifest.md).

## Runtime limits & watchdog (TREK 3.2.0)

| Limit | Value | Source |
|---|---|---|
| RSS ceiling (SIGKILL past it) | **300 MB**, override `TREK_PLUGIN_MAX_RSS_MB` | `supervisor/plugin-supervisor.ts` |
| V8 old-space heap | **192 MB** (`--max-old-space-size=192`) | `paths.ts` |
| Heartbeat / missed-beat kill | every **5 s** / kill after **20 s** | supervisor + host-entry |
| `onLoad` activation timeout | **30 s** (else activation rejected, child killed) | supervisor |
| Route invocation timeout | **30 s** (→ 502) | supervisor |
| Crash policy | **5 crashes / 5 min → auto-disabled** (status `error`); else restart, backoff capped **30 s** | supervisor |
| SIGTERM→SIGKILL grace | **3 s** | supervisor |
| Artifact (install) | 25 MB/file, 50 MB total, 4000 entries | `install/safe-extract.ts` |

## What plugin code can NOT do

No filesystem writes, no reading TREK's files or env secrets, no child
processes, no worker threads, no native addons. The child env is whitelisted to
`NODE_ENV`, `TZ`, `PATH`, `TREK_PLUGIN_ID`. **(TREK ≥ 3.2.1)** the raw child↔host
IPC channel is sealed before your code loads — `process.send` /
`process.on('message')` / `process.disconnect` are revoked, so there is no
lower-level channel than `ctx`. A crash/hang/OOM kills only the plugin's process.
(Operators can weaken the OS-level fs/child sandbox with
`TREK_PLUGIN_PERMISSIONS=off` — don't rely on that being set.)

## Reference implementation

`plugin-sdk/examples/koffi/server/index.js` (TREK repo): a single
membership-checked `GET /state` route computing days-until-trip.
