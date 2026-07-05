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
- `db:own` is backed by a real SQLite file at `.trek-dev/db.sqlite` when the
  Node runtime has `node:sqlite`.
- Simulate an unauthenticated request with `?_anon=1` — an `auth: true` route
  then returns 401, mirroring the host.
- Feed `ctx.trips` / `ctx.users` — and `ctx.config` — with fixtures: drop a
  `dev-fixtures.json` next to the manifest. It accepts three keys: `trips`,
  `users`, and `config` (becomes the frozen `ctx.config` in dev):

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

## Previewing the UI with an emulated host

The dev server exposes three URLs: `/` (a dashboard listing your routes), `/ui`
(your **raw** `client/index.html`), and `/api/<path>` (your routes). Crucially,
**nothing answers the postMessage bridge**: open `/ui` directly and no parent
replies to `trek:ready` / `trek:invoke`, so a widget that fetches its state on
boot stays stuck in its loading state and never receives `trek:context`
(theme/locale). The dev server also sets **no CSP and no sandbox**, so `/ui`
is *not* a faithful preview of the real frame (see the CSP caveat in
[client-bridge.md](client-bridge.md)).

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

Serve the harness from the same origin as the dev server (or enable CORS) so the
`fetch` isn't blocked. This renders the widget with live data and is how you
produce a faithful screenshot — but it does **not** apply the production CSP, so
still validate image/font choices against the real frame.

## `createMockHost` — unit tests

Import from **`trek-plugin-sdk/testing`**. The mock enforces the **same**
permission model as the real host, so tests can prove graceful degradation
when a grant is missing.

```ts
export interface MockHostOptions {
  grants?: string[];                        // permissions to grant the ctx
  config?: Record<string, unknown>;         // becomes ctx.config (frozen)
  /** Fixtures keyed by trip id; `members` gates access like the real host. */
  trips?: Record<number, { members: number[]; data?: unknown;
                           places?: unknown[]; reservations?: unknown[] }>;
  users?: Record<number, unknown>;
  /** Canned db.query results, keyed by the EXACT sql string. */
  queryResults?: Record<string, unknown[]>;
}

export interface MockHost {
  ctx: PluginContext;
  calls: { method: string; args: unknown[] }[];        // names of permission-checked calls
                                                       // (db/trips/users/ws — not log);
                                                       // args is always [] — assert on method names only
  logs: { level: string; msg: string }[];
  broadcasts: { kind: 'trip' | 'user'; target: number;
                event: string; data: unknown }[];
}

export function createMockHost(opts?: MockHostOptions): MockHost;
```

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
  dev server's real SQLite) for real SQL.
- `broadcasts` collects `ws.broadcastTo*` calls so you can assert on events
  without a socket.
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
