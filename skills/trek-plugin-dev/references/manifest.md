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
| `type` | string | **yes** | `integration` \| `page` \| `widget`. |
| `apiVersion` | number | no | Plugin API version; currently `1` (SDK constant `PLUGIN_API_VERSION`). Defaults to `1`. Must be a number, not a string. **Not enforced at install** — the server accepts any numeric value with no version negotiation. |
| `trek` | string | no | Supported TREK semver range, e.g. `">=3.2.0 <4.0.0"`. Its lower bound becomes `minTrekVersion` in the registry entry. The server does **not** gate installs on `min`/`maxTrekVersion` — advisory (registry/CI) only. |
| `author` | string | no | Shown in the store. |
| `description` | string | no | One-line store summary. |
| `icon` | string | no | lucide-react icon name (default `Blocks`). Shown on the **Admin → Plugins** row/store card. **Note:** a page's top-nav entry uses `name` as its label but a **fixed `Blocks` icon** in 3.2.x — the declared `icon` is *not* used for nav. |
| `homepage` | string | no | Project URL. |
| `license` | string | no | Shown in store detail; read, not enforced. |
| `nativeModules` | boolean | no | Must be `false` or absent; `true` is rejected everywhere ("native modules are not allowed (v1)"). |
| `permissions` | string[] | no | Only known permissions (below); an unknown string fails validation. |
| `egress` | string[] | conditional | Required non-empty when any `http:outbound` permission is present. No bare `"*"`. Hosts must match the host grammar (below). |
| `capabilities.widget` | object | no | `{ "title": string, "slot": "sidebar" \| "hero", "defaultSize": … }`. Optional even for widget plugins as far as validation goes; when present, `slot` must be `sidebar` (default) or `hero` — any other value is rejected. **Scaffold gotcha:** `create` writes `{ title, defaultSize: "medium" }` **without `slot`**, so a new widget defaults to `sidebar` — add `"slot": "hero"` yourself if you want the boarding-pass overlay. `defaultSize` is declarative only: the dashboard renders `sidebar` widgets in a **fixed ~180px, `overflow-hidden` slot** regardless, so build compact (see [server-api.md](server-api.md) / client-bridge.md). |
| `settings` | array | no | Settings fields (below). Declared here; **the SDK validator and CI do not validate `settings[]`** — the runtime host renders/enforces them. Plugins write no settings UI. |

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
| `db:read:costs` **(≥3.2.1)** | `ctx.costs.getByTrip` / `listMine` (read-only budget items) | "Costs" = budget items. **Route handlers only** (acting user); `getByTrip` is membership-checked, `listMine` aggregates every accessible trip. Also requires the **Costs (budget) addon enabled**, else `RESOURCE_FORBIDDEN` ("the costs addon is disabled"). |
| `db:write:costs` **(≥3.2.1)** | `ctx.costs.create` (create a budget item) | **Route handlers only** — the one plugin path that **mutates core TREK data**. Needs the addon enabled **+** trip access **+** the acting user's **`budget_edit`** permission (else `RESOURCE_FORBIDDEN`). Input is zod-validated (`name` required, else `BAD_PARAMS`); a success broadcasts `budget:created` to TREK's trip clients. |
| `ws:broadcast:trip` | `ctx.ws.broadcastToTrip` | **Route handlers only**; acting user must be a trip member. Event `plugin:<id>:<event>` to the **core app's** trip clients — **not** your own iframe. |
| `ws:broadcast:user` | `ctx.ws.broadcastToUser` | **Route handlers only**; target must equal the acting user (own connections only). Event `{ type: 'plugin:<id>', event }`. There is **no** `ws:broadcast:*`. |
| `hook:photo-provider` | Reserved: register a `PhotoProvider` | Validates, but the host does **not** consume hooks yet. |
| `hook:calendar-source` | Reserved: register a `CalendarSource` | Same. |
| `http:outbound` | Marker: plugin does outbound HTTP | Satisfies the "egress required" rule but grants **no host** by itself. |
| `http:outbound:<host>` | Opens `<host>` in the runtime egress guard **and** the iframe CSP `connect-src` | This is what actually allows a request. |

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
| `input_type` | **snake_case**: `text` (default), `password`, `number`, `select`, … Live form rendering is host/version-dependent — the **3.2.0 client shows only a read-only preview** (label + scope + required), no value-entry widgets; verify against your target build. |
| `scope` | `instance` (default — set once by admin) or `user` (per-user). |
| `required` | boolean. |
| `secret` | boolean — encrypted at rest, decrypted only into server-side `ctx.config`, never sent to the iframe. |
| `placeholder`, `hint` | Form hints. |
| `options` | `[{ "value": …, "label": … }]` for `select`. |
| `oauth` | `{ "initPath": …, "callbackPath": … }` — **descriptive metadata only** (like `routes[]`); the host doesn't mount or drive it. Implement the flow with your own routes (an `auth:false` callback, relative in-app redirect). |

Resolved **instance-scoped** values arrive in `ctx.config` — decrypted and
**frozen at activation** (not per-user, not hot-reloaded; a change needs
deactivate→activate). `scope: user` settings are **not** surfaced to server
`ctx.config` in 3.2.0.

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
