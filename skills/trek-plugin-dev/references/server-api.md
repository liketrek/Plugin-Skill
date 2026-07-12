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

  // Cron jobs — run via node-cron when jobs:run is granted (see below).
  jobs: [
    { id: 'refresh', schedule: '*/15 * * * *', async handler(ctx) { /* … */ } },
  ],
})
```

The routes and job ids on the **loaded definition are authoritative** (a
route's array index is its internal id); the `routes` block in the manifest is
never consumed.

> ⚠️ **`jobs[]` need the `jobs:run` grant.** The host-side runner
> (`plugin-jobs.ts` `scheduleJobs()`) wires each declared job's cron to node-cron
> and fires `invoke.job` on the tick — **only when `jobs:run` is granted**
> (without it, jobs never run; an invalid cron is skipped). Jobs run **userless**
> (own-`db`/egress/brokers only; trip reads → `RESOURCE_FORBIDDEN`). For
> future/recurring callbacks under your own control there is also the
> **persistent `ctx.scheduler`** (`at`/`in`/`every`/`cancel`, same grant), which
> fires a `scheduled({name, payload}, ctx)` handler and **survives restarts** —
> see the scheduler row in the semantics table.

## Type surface (from `trek-plugin-sdk`)

```ts
export const PLUGIN_API_VERSION = 1;

export interface PluginDefinition {
  onLoad?(ctx: PluginContext): Promise<void> | void;
  onUnload?(ctx: PluginContext): Promise<void> | void;
  routes?: PluginRoute[];
  jobs?: PluginJob[];               // run via node-cron under jobs:run (see above)
  events?: PluginEventSubscription[]; // WIRED reactive hook — needs events:subscribe
  scheduled?(input: { name: string; payload?: unknown }, ctx): Promise<void> | void; // ctx.scheduler callbacks (jobs:run)
  deleteUserData?(userId: number, ctx): Promise<void> | void; // hook:user-data — GDPR erasure, userless
  exportUserData?(userId: number, ctx): Promise<unknown>;     // hook:user-data — GDPR export, userless
  exports?: Record<string, (args, ctx) => unknown>;  // capabilities.provides targets — called by dependents
  subscriptions?: { plugin: string; event: string; handler(payload, ctx): void }[]; // consume a dependency's emits
  hooks?: {                                    // all WIRED — each needs its hook:* grant
    photoProvider?: PhotoProvider;
    calendarSource?: CalendarSource;           // getEvents(userId, startISO, endISO) — ISO strings, not Dates
    placeDetailProvider?: PlaceDetailProvider; // getDetails(placeId, ctx) → {label,value?,url?}[]
    warningProvider?: WarningProvider;         // getWarnings(tripId, ctx) → {level,message,dayId?,placeId?}[]
    tableContributor?: TableContributor;       // hook:table-contributor — columns/actions on core table views
    mapMarkerProvider?: MapMarkerProvider;     // hook:map-marker-provider
    pdfSectionProvider?: PdfSectionProvider;   // hook:pdf-section-provider
    atlasLayerProvider?: AtlasLayerProvider;   // hook:atlas-layer-provider
    journalEntryProvider?: JournalEntryProvider; // hook:journal-entry-provider
    tripCardProvider?: TripCardProvider;       // hook:trip-card-provider
    notificationChannel?: NotificationChannel; // hook:notification-channel — USERLESS; recipient's settings as config
  };
  actions?: Record<string, (ctx) => Promise<{ ok: boolean; message?: string }>>; // manifest `actions` buttons — user-bound
}

// core-event subscription — see "Event subscriptions" below
export interface PluginEventSubscription {
  on: string;   // 'place:created' | 'day:updated' | 'file:created' | … | '*'
  // payload also carries entity/entityId/snapshot — snapshot only when
  // the plugin ALSO holds the family's db:read:* grant (else absent). Still no user.
  handler(payload: { event: string; tripId: number;
                     entity?: string; entityId?: number; snapshot?: Record<string, unknown> },
          ctx: PluginContext): Promise<void> | void;
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
  headers?: Record<string, string>; // auth:false routes ONLY — a credential-free
                                     // allowlist (provider signature/event headers; never
                                     // Cookie/Authorization). Empty on authenticated routes.
}
export interface PluginResponse { status: number; headers?: Record<string, string>; body?: unknown; }

export interface PluginContext {
  readonly id: string;
  readonly config: Readonly<Record<string, unknown>>;    // instance-scoped, frozen at activation
  db: {
    query<T = unknown>(sql: string, ...args: unknown[]): Promise<T[]>;
    exec(sql: string, ...args: unknown[]): Promise<{ changes: number }>;
    migrate(id: string, sql: string): Promise<{ applied: boolean }>;
    tx(ops: { sql: string; args?: unknown[] }[]): Promise<({ rows: unknown[] } | { changes: number })[]>; // atomic batch on your OWN db, ≤100 ops
  };
  settings: { get(key: string): Promise<unknown> };   // acting user's own scope:'user' value; undefined if unset/userless
  // reads return typed entities (Trip/Place/Day/Reservation/PackingItem/
  // TripFile/BudgetItem/Assignment/User) — but only `id` is guaranteed; every shape
  // keeps an index signature and mirrors the raw DB row, so treat other fields as optional.
  trips: {
    getById(tripId, asUserId?): Promise<Trip | null>; getPlaces(...): Promise<Place[]>; getReservations(...): Promise<Reservation[]>;
    update(tripId: number, input: Record<string, unknown>): Promise<Trip>;      //
    getDays(tripId): Promise<Day[]>; getAccommodations(tripId): Promise<unknown[]>; //
    listMine(): Promise<Trip[]>;                          // all accessible trips
    members(tripId): Promise<unknown[]>;                  // db:read:trips — roster
    addMember(tripId, userId): Promise<{ joined: boolean }>;   // db:write:members + member_manage — GRANTS ACCESS
    removeMember(tripId, userId): Promise<{ removed: boolean }>; // can't remove owner
    create(input: Record<string, unknown>): Promise<Trip>;    // db:create:trips + trip_create; title required
  };
  // full booking writes
  reservations: {
    listMine(): Promise<unknown[]>;                      // db:read:trips
    create(tripId, input); update(tripId, id, input); delete(tripId, id): Promise<{ deleted: boolean }>; // db:write:reservations + reservation_edit
    // create/update persist `endpoints` (from/to/stop legs): omit=keep, []=delete all, array=replace
  };
  accommodations: { create(tripId, input); update(tripId, id, input); delete(tripId, id): Promise<{ deleted: boolean }> }; // db:write:accommodations + day_edit; create auto-adds partner reservation
  packing: {
    list(tripId: number): Promise<PackingItem[]>;         // db:read:packing
    create(tripId, input); update(tripId, id, input); delete(tripId, id): Promise<{ deleted: boolean }>; // db:write:packing + packing_edit
    listBags(tripId); createBag(tripId, input); updateBag(tripId, id, input); deleteBag(tripId, id); setBagMembers(tripId, id, memberIds); // ALL under db:write:packing
  };
  files: {
    list(tripId: number): Promise<TripFile[]>;            // db:read:files
    getContent(tripId, fileId): Promise<{ name; mimetype; size; content_base64 }>; // db:read:files:content — 10MB cap, trashed refused
    create(tripId, input); createLink(tripId, input); update(tripId, id, input); softDelete(tripId, id); // db:write:files + file_upload/file_edit/file_delete
  };
  daynotes:    { list(tripId, dayId); create(tripId, dayId, input); update(tripId, id, input); delete(tripId, id) }; // db:read/write:daynotes (+ day_edit for writes)
  todos:       { list(tripId); create(tripId, input); update(tripId, id, input); delete(tripId, id) };   // db:read/write:todos (+ packing_edit for writes)
  tags:        { list(); create(input); update(id, input); delete(id) };  // db:read/write:tags — the acting user's own tags
  categories:  { list(): Promise<unknown[]> };            // db:read:categories — global place-category reference
  collab:      { listNotes(tripId); listPolls(tripId); listMessages(tripId, before?);         // db:read:collab
                 createNote(tripId, input); createPoll(tripId, input); votePoll(tripId, id, opt); createMessage(tripId, input) }; // db:write:collab + collab_edit; Collab addon
  journal:     { listMine(); getEntries(journeyId);                                            // db:read:journal
                 createEntry(journeyId, input); updateEntry(id, input); deleteEntry(id); createJourney(input); deleteJourney(id) }; // db:write:journal; Journey addon
  atlas:       { visited(); bucketList();                                                       // db:read:atlas
                 markCountry(code); unmarkCountry(code); markRegion(id); unmarkRegion(id); createBucketItem(input); deleteBucketItem(id) }; // db:write:atlas; acting user's own
  vacay:       { mine(); toggleEntry(date); toggleCompanyHoliday(date, note?) };  // db:read/write:vacay; Vacay addon
  collections: { listMine(); get(id); create(input); update(id, input); savePlace(id, place); copyToTrip(id, tripId); deletePlace(id, placeId) }; // db:read/write:collections; Collections addon
  costs: {                                               // budget items
    getByTrip(tripId: number): Promise<unknown[]>;
    listMine(): Promise<unknown[]>;
    // input amount key is `total_price` (number), NOT `amount` — unknown keys are stripped → saves 0
    create(tripId: number, input: Record<string, unknown>): Promise<unknown>;
    update(tripId: number, itemId: number, input: Record<string, unknown>): Promise<unknown>;
    delete(tripId: number, itemId: number): Promise<{ deleted: boolean }>;
  };
  // permission-gated trip-planner writes
  places: { create(tripId, input); update(tripId, placeId, input); delete(tripId, placeId): Promise<{ deleted: boolean }> };
  days:   { create(tripId, input); update(tripId, dayId, input); delete(tripId, dayId): Promise<{ deleted: boolean }> };
  // days.create takes { date?, notes?, position? } — a `title` is DROPPED here; set it via days.update.
  itinerary: { assign(tripId, dayId, placeId, notes?); unassign(tripId, assignmentId): Promise<{ deleted: boolean }> };
  meta: {                                                // plugin-private KV on core entities
    // entityType widened to also include 'reservation' | 'accommodation'
    get(entityType: 'trip' | 'place' | 'day' | 'reservation' | 'accommodation', entityId: number, key: string): Promise<unknown>;
    set(entityType, entityId, key, value): Promise<{ key: string; value: unknown }>;
    list(entityType, entityId): Promise<Record<string, unknown>>;
    delete(entityType, entityId, key): Promise<{ deleted: boolean }>;
  };
  users: { getById(id: number): Promise<unknown> };
  ws: {
    broadcastToTrip(tripId: number, event: string, data): Promise<void>;
    broadcastToUser(userId: number, event: string, data): Promise<void>;
  };
  // host-mediated brokers — tenant-free services, not DB namespaces
  notify: { send(input: { title; body; link?; scope: 'user' | 'trip'; targetId }): Promise<{ sent: boolean }> }; // notify:send — recipient forced to acting user/their trip
  ai:     { complete(prompt, system?): Promise<{ text: string }>;                                     // ai:invoke — acting user's provider, no key held
            extract(text, jsonSchema, prompt?): Promise<{ results: Record<string, unknown>[] }> };    // 20000-char cap, output is DATA-only
  oauth:  { getAccessToken(): Promise<string | null> };  // oauth:client — user-connected service; null when userless/unconnected
  rates:  { get(...): Promise<unknown> };                 // rates:read — currency rates (tenant-free)
  weather:{ get(...): Promise<unknown> };                 // weather:read — by coords, host-cached (tenant-free)
  scheduler: {                                            // jobs:run — persistent, userless, restart-surviving
    at(whenMs: number, name: string, payload?): Promise<{ scheduled: boolean }>;   // absolute epoch-ms
    in(ms: number, name: string, payload?): Promise<{ scheduled: boolean }>;       // once, after ms
    every(ms: number, name: string, payload?): Promise<{ scheduled: boolean }>;    // repeat every ms (first after ms)
    cancel(name: string): Promise<{ cancelled: boolean }>;
    // TIME FIRST, name second. Setting is an UPSERT by name. Caps: ≤100 tasks,
    // name ≤128 chars, payload ≤8 KB, interval ≥60s, ≤1yr out → scheduled({name,payload}, ctx)
  };
  plugins: { call(pluginId: string, fn: string, args): Promise<unknown> }; // call a dependency's capabilities.provides export (runs as current user)
  events:  { emit(name: string, payload): Promise<void> }; // publish to dependents; name must be in capabilities.emits
  log: { info(msg, meta?): void; warn(msg, meta?): void; error(msg, meta?): void };
}
```

## `ctx` semantics and required permissions

| Area | Behavior | Requires |
|---|---|---|
| `ctx.db` | Your **own** SQLite file (never `trek.db`). `migrate(id, sql)` runs a keyed, idempotent migration once per id. Refused SQL: `ATTACH` / `DETACH` / `VACUUM` / `PRAGMA` / **`RECURSIVE`**. **Caps:** DB ≤ **256 MB** (further writes fail `SQLITE_FULL`), a single `query` returns ≤ **100 000 rows**, SQL text ≤ **100 000 chars**. | `db:own` |
| `ctx.trips` | Read-only; **route handlers only**. The host binds the acting user from the request and membership-checks every read. `asUserId` is **ignored** (can't impersonate). From `onLoad`/`jobs` (no user) → `RESOURCE_FORBIDDEN`. | `db:read:trips` |
| `ctx.users.getById` | **Route handlers only** (needs acting user). Returns **only the acting user themselves or a user who co-members a trip with them** (`id, username, display_name, avatar`) — **not** a free lookup of any account by id; others → `RESOURCE_FORBIDDEN`. | `db:read:users` |
| `ctx.packing.list(tripId)` | **Route handlers only** (host-bound acting user; `onLoad`/jobs → `RESOURCE_FORBIDDEN`). A trip's packing items with bags/assignees hydrated, **scoped to what the acting user may see** — another member's private items are filtered out (same as the app). Separate scope from `files`. | `db:read:packing` |
| `ctx.files.list(tripId)` | **Route handlers only** (acting user; membership-checked). A trip's files with **trash excluded** — the same view the files tab shows. | `db:read:files` |
| `ctx.costs.getByTrip` / `listMine` | "Costs" = budget items. **Route handlers only** (host-bound acting user; `onLoad`/jobs → `RESOURCE_FORBIDDEN`). `getByTrip` membership-checks the trip; `listMine` returns items across every trip the user can access. Requires the **Costs addon enabled** (else `RESOURCE_FORBIDDEN`: "the costs addon is disabled"). | `db:read:costs` |
| `ctx.costs.create` / `update(tripId, itemId, input)` / `delete(tripId, itemId)` | **Route handlers only.** Create/edit/remove budget items (frozen FX + members/payers); **broadcasts `budget:created/updated/deleted`**. Requires the Costs addon **+** trip access **+** the acting user's **`budget_edit`**; input zod-validated (→ `BAD_PARAMS`). **The amount field is `total_price` (a number), NOT `amount`** — accepted keys: `name` (required), `total_price`, `currency`, `category`, `exchange_rate`, `payers`, `member_ids`, `note`, `expense_date`, … (`budgetCreateItemRequestSchema`). ⚠️ **zod strips unknown keys silently**, so `{ name, amount: 5000 }` **succeeds but saves the item at 0** (no error, shows "¥ 0") — pass `total_price`. | `db:write:costs` |
| `ctx.trips.update(tripId, input)` | **Route handlers only.** Edit trip fields (`title`/`start_date`/`end_date`/`currency`/`reminder_days`/…). Trip access **+** the acting user's **`trip_edit`**; setting `is_archived` also needs **`trip_archive`**, `cover_image` needs **`trip_cover_upload`**. zod-validated (→ `BAD_PARAMS`); broadcasts `trip:updated`. | `db:write:trips` |
| `ctx.places.*` / `ctx.days.*` / `ctx.itinerary.*` | **Route handlers only.** Create/update/delete planner places & days; assign/unassign places to days. Trip access **+** the matching edit permission (`place_edit` / `day_edit` / `day_edit`); the day & place must belong to the trip. zod-validated (→ `BAD_PARAMS`); each broadcasts the app's real event (`place:*` / `day:*` / `assignment:*`) and is audited. | `db:write:places` / `db:write:days` / `db:write:itinerary` |
| `ctx.meta.*` | **Route handlers only.** The plugin's **own** namespaced KV store on a `trip`/`place`/`day` — **and `reservation`/`accommodation`** (`get`/`set`/`list`/`delete`). Reads need trip access; writes need the entity's edit permission. Per-plugin namespace; quotas key ≤ 256 chars / value ≤ 64 KB JSON / ≤ 100 keys per entity (over → `BAD_PARAMS`). Enrich core entities without forking the schema. ⚠️ **Can be `undefined` on real hosts too** — never hard-depend; see the optional-namespaces note below. | `db:meta` |
| `ctx.db.tx(ops)` | Run **≤ 100** statements atomically on your **own** db (all commit or roll back). Each op `{sql, args?}`; reads see the batch's earlier writes; a read op returns `{rows}`, a write `{changes}`. Same refused-SQL/length caps as `ctx.db`. | `db:own` |
| `ctx.settings.get(key)` | The **acting user's own** decrypted value for a `scope:'user'` field. `undefined` for unset or a **userless** (`onLoad`/job/scheduler) context — fall back to `ctx.config`. Wired unconditionally (no grant). | — |
| `ctx.reservations.*` / `ctx.accommodations.*` | **Route handlers only.** `reservations.listMine()` (read, `db:read:trips`); create/update/delete need `reservation_edit` and persist `endpoints` (omit=keep, `[]`=delete all, array=replace). `accommodations.*` need `day_edit`; creating one **auto-creates the partner hotel reservation**. | `db:write:reservations` / `db:write:accommodations` |
| `ctx.files.getContent` / writes | **Route handlers only.** `getContent(tripId, fileId)` → `{name, mimetype, size, content_base64}` (10 MB cap, trashed refused) needs the **distinct** `db:read:files:content` (listing ≠ reading bytes). `create`/`createLink`/`update`/`softDelete` need `db:write:files` **+** `file_upload`/`file_edit`/`file_delete`; blocked extensions refused. | `db:read:files:content` / `db:write:files` |
| `ctx.packing` writes + bags | **Route handlers only.** `create`/`update`/`delete` and **all bag methods** (`listBags`/`createBag`/`updateBag`/`deleteBag`/`setBagMembers`) need `packing_edit`. ⚠️ **`db:read:packing` unlocks only `list`; every bag method — incl. `listBags` — needs `db:write:packing`.** `create` shape: `{name, category?, checked?, is_private?, visibility?, recipient_ids?}`. | `db:write:packing` |
| `ctx.trips` roster + lifecycle | **Route handlers only.** `getDays`/`getAccommodations`/`listMine`/`members` are reads (`db:read:trips`). `addMember`/`removeMember` need `db:write:members` **+** `member_manage` — ⚠️ **`addMember` grants trip access**, and the owner can't be removed. `create(input)` needs `db:create:trips` **+** `trip_create` (title required). | `db:read:trips` / `db:write:members` / `db:create:trips` |
| **Personal-data & addon subsystems** `ctx.collab` / `journal` / `atlas` / `vacay` / `collections` / `daynotes` / `todos` / `tags` / `categories` | **Route handlers only** (userless → `RESOURCE_FORBIDDEN`). Each has a `db:read:<x>` for its reads and a `db:write:<x>` for its writes; `collab`/`journal`/`atlas`/`vacay`/`collections` also require their **addon enabled** (else `RESOURCE_FORBIDDEN`). Scoping: `atlas`/`vacay`/`tags`/`collections`/`journal` act on the **acting user's own** data; `daynotes` writes ride on `day_edit`, `todos` writes on `packing_edit`, `collab` writes on `collab_edit`; `categories.list()` is global reference data. See the manifest catalog for the exact method→scope map. | `db:read:<x>` / `db:write:<x>` |
| **Host brokers** `ctx.notify` / `ai` / `oauth` / `rates` / `weather` | Host-mediated services, **not** DB namespaces — detailed in "Host-mediated brokers" below. `notify.send` and `oauth.getAccessToken` are acting-user-scoped (route-only); `ai`/`rates`/`weather` are tenant-free (work userless too). | `notify:send` / `ai:invoke` / `oauth:client` / `rates:read` / `weather:read` |
| `ctx.scheduler.*` | Persistent, **userless**, restart-surviving timers firing the `scheduled({name, payload}, ctx)` handler: `at(whenMs, name, payload?)` (absolute epoch-ms), `in(ms, name, payload?)`, `every(ms, name, payload?)`, `cancel(name)` — **time first, name second**; setting is an **upsert by name**. Caps: ≤ 100 tasks, name ≤ 128 chars, payload ≤ 8 KB, interval ≥ 60 s, ≤ 1 yr out. Same grant as declared cron jobs. | `jobs:run` |
| `ctx.plugins.call` / `ctx.events.emit` | Inter-plugin: `plugins.call(pluginId, fn, args)` invokes a **dependency's** `capabilities.provides` export (runs as the current user); `events.emit(name, payload)` publishes to dependents that subscribed (`name` must be in `capabilities.emits`). Authorized via declared dependency edges. | — (declared deps) |
| `ctx.ws.broadcastToTrip` | **Route handlers only.** The acting user must be a member of the target trip. Event to the **core TREK app's** trip-room clients as `plugin:<id>:<event>`. | `ws:broadcast:trip` |
| `ctx.ws.broadcastToUser` | **Route handlers only.** Target **must equal the acting user** (`userId === req.user.id`) — you can only push to the acting user's **own** connections. Event to core clients as `{ type: 'plugin:<id>', event, ...data }`. | `ws:broadcast:user` |
| `ctx.config` | **Instance-scoped** settings, decrypted and **frozen at activation** (`secret:true` arrive decrypted, server-side only). Not per-user; not hot-reloaded — change requires deactivate→activate. `scope:user` settings are **not** surfaced here — read them via `ctx.settings.get(key)` (row above). | — |
| `ctx.log` | `info`/`warn`/`error` → the plugin's error log in Admin → Plugins. | — |
| `ctx.id` | Your plugin id (also in `process.env.TREK_PLUGIN_ID`). | — |

> **Never hard-depend on the enrichment namespaces — even on a real host.** The
> optional namespaces (`ctx.meta`, `places`, `days`, `itinerary`, `costs`,
> `packing`, `files`, `trips.update`) have been observed **partly `undefined` on
> real production hosts** (independent of the dev server, which has full parity on
> the current SDK — see [testing.md](testing.md)): a live
> route using `ctx.meta.set(…)` crashed with `Cannot read properties of
> undefined (reading 'set')`. So never build a feature that *hard-requires*
> them. The robust pattern:
>
> - **`db:own` is the source of truth** for your plugin's own data; mirror into
>   `ctx.meta` only **best-effort** (so core surfaces that read meta stay
>   enriched where it exists, but nothing breaks where it doesn't).
> - Route every optional-`ctx.*` call through a guard that takes a **thunk**, so
>   the *synchronous property throw* on an `undefined` namespace is caught too —
>   `attempt(ctx.meta.set(x))` throws while evaluating the argument, *before*
>   `attempt` runs; `attempt(() => ctx.meta.set(x))` catches it:
>
> ```js
> async function attempt(fn, fallback) {
>   try { return await fn() } catch (e) { return fallback }
> }
> // db:own first (source of truth), meta second (best-effort mirror):
> await ctx.db.exec('INSERT OR REPLACE INTO pins (trip_id, data) VALUES (?, ?)', tripId, json)
> await attempt(() => ctx.meta.set('trip', tripId, 'pinned', data))
> ```

> **`ctx.ws.broadcast*` never reaches your own plugin UI.** Broadcasts go to the
> **core TREK app's** WebSocket clients; there is no path forwarding
> `plugin:<id>:*` events into your sandboxed iframe (the frame can't open the
> credentialed `/ws`, and the bridge only relays `trek:context`/`trek:response`/
> `trek:error`). For your widget/page to reflect live state, **poll your own
> route via `trek:invoke`**. `ws:broadcast:*` is only useful to drive parts of
> TREK that explicitly consume the event.

## Host-mediated brokers

Five tenant-free host services, distinct from the DB namespaces — the plugin
never holds a key/secret; the host brokers the call:

- **`ctx.notify.send({ title, body, link?, scope: 'user'|'trip', targetId })`**
  (`notify:send`) — the recipient is **forced** to the acting user or a trip they
  belong to (admin scope refused); `title` emoji-stripped and ≤ 200, `body`
  ≤ 1000, `link` must be an in-app `/…` path. **Route-only** (needs the acting
  user).
- **`ctx.ai.complete(prompt, system?)` → `{ text }`** and
  **`ctx.ai.extract(text, jsonSchema, prompt?)` → `{ results: object[] }`** (`ai:invoke`) —
  uses the **acting user's** configured provider; 20 000-char cap; the output is
  **data only** (treat it as untrusted text, never as instructions).
- **`ctx.oauth.getAccessToken()` → `string | null`** (`oauth:client`) — a
  short-lived token for a service the user connected via **Settings → Plugins →
  Connect**; `null` when userless or not connected. Route-only in practice.
  **Wiring the broker:** declare five `scope:'instance'` settings named exactly
  `oauth_authorize_url`, `oauth_token_url`, `oauth_scopes` (optional),
  `oauth_client_id`, `oauth_client_secret`; the admin fills them, and the
  **host** runs the whole PKCE+state flow (`POST /api/plugin-oauth/<id>/connect`
  → provider → callback → redirect to `/settings?oauth=<id>:connected|denied|failed`,
  plus `/status` and `/disconnect`). Tokens are per-user, encrypted, and
  auto-refreshed (60 s skew); endpoints must be `https` and pass an SSRF gate;
  the plugin **never sees** the refresh token or client secret.
- **`ctx.rates.get(…)`** (`rates:read`) and **`ctx.weather.get(…)`**
  (`weather:read`) — currency rates / weather-by-coords, host-cached and
  **tenant-free**, so they work from jobs/scheduler too.

## Provider hooks

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

**Six more declarative contribution hooks** (each `hook:*`-gated,
its own consuming controller, host-sanitized — emoji stripped from any text — and
fail-safe on throw/timeout), so an `integration` can inject **native** UI with no
iframe of its own:

- **`tableContributor`** (`hook:table-contributor`) — columns/actions on core
  table views (reservations/places/day/costs/packing/files).
- **`mapMarkerProvider`** (`hook:map-marker-provider`) — markers on the trip map.
- **`pdfSectionProvider`** (`hook:pdf-section-provider`) — sections in the exported PDF.
- **`atlasLayerProvider`** (`hook:atlas-layer-provider`) — labelled atlas layers.
- **`journalEntryProvider`** (`hook:journal-entry-provider`) — rows in journal entries.
- **`tripCardProvider`** (`hook:trip-card-provider`) — badges/content on dashboard trip cards.

**`photoProvider` / `calendarSource` are wired too**
(`plugin-photos.controller.ts` / `plugin-calendar.controller.ts` consume them;
`CalendarSource.getEvents(userId, start, end)` takes `start`/`end` as ISO
**strings** — the host↔plugin boundary is JSON).

A plugin can also be a **notification delivery channel**
(`hook:notification-channel` + `capabilities.notificationChannel.events`):
implement `hooks.notificationChannel` and TREK routes matching notifications
(e.g. `trip_invite`, `booking_change`, `trip_reminder`) through your plugin —
Telegram/Gotify/webhook delivery without touching core. The hook runs
**userless**, receiving the recipient's decrypted per-user settings as its
config. `create --template notification-channel` scaffolds one.

There is also a **data-rights hook** `hook:user-data`: define
`deleteUserData(userId, ctx)` / `exportUserData(userId, ctx)` and the host calls
them **durably** on account erasure/export. They run **userless** — you get only
a `userId` and act on your **own `db:own`** data; the hook grants no core read.
Implement it if your plugin stores personal data (GDPR erasure/portability).

The `hook:*` grant is **enforced at dispatch**: core only wires a provider that is
active, implements the hook in code, **and** holds the matching `hook:*`
permission. If a provider "never fires", check the manifest `permissions` first.

Hooks feed **core UI** without your own iframe; the scoped **widget slots**
(`place-detail`/`day-detail`/`reservation-detail`) are the other route (your own
sandboxed panel — see [client-bridge.md](client-bridge.md)).

## Event subscriptions

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
- **Payload:** `{ event, tripId, entity?, entityId?, snapshot? }` — `entity` is
  the family (e.g. `'reservation'`), `entityId` which entity changed, and
  `snapshot` a whitelisted shallow copy of the changed fields, so you can act
  without a follow-up read. ⚠️ **`snapshot` is delivered only when the plugin
  also holds that family's `db:read:*` grant** — without it you get only
  `{ event, tripId }`. Either way the handler runs with **no user**
  (`ctx.trips`/`packing`/`files`/`costs`/`meta` reads → `RESOURCE_FORBIDDEN`);
  react with `ctx.db`, `ctx.ws.*`, or an outbound call.
- **Fire-and-forget, ~5 s timeout, best-effort:** a slow or throwing subscriber is
  dropped and can never block or fail a core write.
- Your own `plugin:<id>:*` broadcasts are **not** re-delivered, so a handler that
  broadcasts can't loop back into itself.
- The grant is enforced host-side: an active plugin that implements `events` but
  lacks `events:subscribe` is silently never called.

## Inter-plugin capabilities

Plugins can call and notify each other along **declared dependency edges** — the
producer lists `capabilities.provides` / `capabilities.emits`, the consumer lists
`pluginDependencies` (see [manifest.md](manifest.md)):

- **`ctx.plugins.call(pluginId, fn, args)`** — invoke another plugin's
  `capabilities.provides` export (its definition-level `exports[fn]`). Runs as the
  **current user**, so the callee's own `ctx` permission checks still apply.
- **`ctx.events.emit(name, payload)`** — publish an event (`name` must be in your
  `capabilities.emits`) to every dependent that declared a matching
  `subscriptions` entry; their handler runs with the emitted payload.
- Definition keys: `exports: { <fn>(args, ctx) }` (the callable targets) and
  `subscriptions: [{ plugin, event, handler }]` (consume a dependency's emits).

The host routes these via `exportsOf` / `subscribersOf` built from the declared
edges — an undeclared call/emit is refused.

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
- The proxy forwards `{ method, path, query, body, user, headers }` — no session
  cookie. `req.headers` is populated on **`auth:false` (webhook) routes only** —
  a credential-free **allowlist** of inbound headers (provider signature + event
  headers; **never** `Cookie` / `Authorization` / session). Empty on
  authenticated routes. This is how you **verify a webhook signature** against a
  secret in `ctx.config`/`ctx.settings`.
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

## Runtime limits & watchdog

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
| **RPC rate limit** | Per-plugin token bucket at the `ctx` dispatch boundary: **burst 60, 20/s, 16 in-flight** (env `TREK_PLUGIN_RPC_BURST` / `_PER_SEC` / `_INFLIGHT`). A runaway plugin is throttled instead of freezing the single-threaded host. | `host/rate-limit.ts` |

## What plugin code can NOT do

No filesystem writes, no reading TREK's files or env secrets, no child
processes, no worker threads, no native addons. The child env is whitelisted to
`NODE_ENV`, `TZ`, `PATH`, `TREK_PLUGIN_ID`. The raw child↔host
IPC channel is sealed before your code loads — `process.send` /
`process.on('message')` / `process.disconnect` are revoked, so there is no
lower-level channel than `ctx`. A crash/hang/OOM kills only the plugin's process.
(Operators can weaken the OS-level fs/child sandbox with
`TREK_PLUGIN_PERMISSIONS=off` — don't rely on that being set.)

## Reference implementation

`plugin-sdk/examples/koffi/server/index.js` (TREK repo): a single
membership-checked `GET /state` route computing days-until-trip.
