# `trek-plugin` CLI reference

Ships in the npm package **`trek-plugin-sdk`** (Node >= 18). Two equivalent
bins, `trek-plugin-sdk` and `trek-plugin`, plus a scaffold-only bin
`create-trek-plugin` (`create-trek-plugin <name> [--type …]` — requires a
name, runs no other commands). Invoke without installing:

```bash
npx trek-plugin-sdk <command> [args]
```

| Command | Needs | What it does |
|---|---|---|
| `create [name] [--type t] [--author x] [--description x] [--permissions "a,b"] [--interactive]` | — | Scaffold a plugin. No name (or `--interactive`) → a **Clack wizard** (id, **location**, type, author, **description**, multiselect permissions, and — if `http:outbound` is picked — **egress hosts**), then offers `git init` + `npm install`. With a name it's non-interactive and still requires the name. The page/widget scaffold emits a **design-kit client** (`<!-- trek:ui -->` marker + a `window.trek` UI). |
| `dev [dir] [--port 4317]` | — | Local dev server (default `http://localhost:4317`) with hot reload, SDK injection, permission-enforcing `ctx`. Also serves a themed host preview at **`/preview`**, expands the `<!-- trek:ui -->` marker on `/ui`, and exposes `/__dev/fire/*` for non-route entry points. See [testing.md](testing.md). |
| `validate [dir]` | — | Manifest + layout checks (same manifest rules as the install loader). Fails on invalid `trek-plugin.json`, missing `README.md`, or missing `server/index.js`; warns if dir name ≠ id, README lacks a screenshot, or scaffold placeholders remain. Since `pack` validates first, a missing README also fails `pack`. **Subset of CI** — CI additionally verifies release/sha256/README over the network. |
| `pack [dir] [--out plugin.zip] [--json]` | — | Validates, then builds `plugin.zip` in the installer's exact layout; prints **sha256 + byte size**. `--json` for machine-readable output. ⚠️ Zip mod dates are fixed (deterministic for a given SDK+machine), but re-packs on other machines/SDK versions can still differ (CRLF, walk order) — the registry `sha256`/`size` must come from the **uploaded release asset**, never a re-pack (see [publishing.md](publishing.md)). |
| `entry [dir] --repo <owner/name> --tag <vX.Y.Z> [--dir d] [--zip plugin.zip] [--commit <sha>] [--asset <name>] [--merge <entry.json>] [--out <file>] [--sign [key]]` | git + network | Emits the ready-to-PR registry entry: resolves `commitSha` from the tag (`git rev-parse <tag>^{commit}`), fills `downloadUrl`, `sha256`, `size`, `apiVersion`, `minTrekVersion`. `--merge` prepends the new version (newest-first) and refuses a key switch / unsigned update to a signed plugin. ⚠️ **Run it only after the GitHub release with `plugin.zip` attached exists** — it verifies the release asset and fails with `artifact not found` otherwise. Order: pack → release (asset attached) → `entry`. |
| `release [dir] --repo <o/n> --tag <vX.Y.Z> [--out] [--notes] [--commit] [--merge] [--sign [key]]` | git + `gh` (authed) | One shot: `pack` → `gh release create` (uploads the zip) → prints the entry. |
| `preflight [dir] --repo <o/n> --tag <vX.Y.Z> [--all] [--entry <file.json>] [--zip] [--commit] [--sign]` | network | Runs the **full registry CI locally**: tag→commit, manifest parity, artifact sha256 + size, native scan, README gate. **Default checks only the newest version; `--all` checks every `versions[]`.** Green preflight ⇒ green CI. |
| `submit --repo <o/n> --tag <vX.Y.Z> [--branch <name>] [--keep] [--draft] [--registry <owner/name>] [--zip] [--commit] [--sign [key]]` | `gh` (authed) | Forks TREK-Plugins (once), branches (`plugin-<id>-<version>` unless `--branch`), writes/merges the entry, pushes, opens the PR. `--keep` keeps the temp clone dir. **`submit` does NOT run preflight** (a clean path if you ever need to skip it). |
| `publish --repo <o/n> --tag <vX.Y.Z> [--sign [key]] [--no-preflight] [--draft] [--registry <owner/name>] [--notes <text>]` | git + `gh` (authed) | **One-command release:** pack → tag + GitHub release → preflight → registry PR. Stops before submitting if preflight fails — **`--no-preflight` skips that safety gate** (don't, in general). Works for every type incl. `trip-page` on the current SDK. |
| `keygen [--key <file>]` | — | Creates a dependency-free Ed25519 signing key (default `~/.trek-plugin/signing.key`; back it up!). |
| `sign [zip] [--key <file>]` | key | **Prints** `signature` + `authorPublicKey` for an artifact (default `plugin.zip`) — does **not** modify any entry. |

`--sign [key]` on `entry`/`release`/`submit`/`publish` is what actually **writes**
`authorPublicKey` + `signature` into the generated entry (default key
`~/.trek-plugin/signing.key`, or an inline path / `--key`). `submit`/`entry
--merge` refuse a *different* key or an *unsigned* update to a signed plugin.

## Interactive mode

Running `npx trek-plugin-sdk` with **no command** in a terminal opens a menu
(Create / dev / validate / pack / publish, plus an **Advanced…** submenu for
keygen/sign/entry/preflight/submit/release). Any command missing required args
(`--repo`/`--tag`) now **prompts** for them instead of erroring, and
`publish`/`submit`/`release` show a confirm before the release/PR. This is purely
additive: in non-interactive contexts (CI, pipes, or when a command is given)
behavior is unchanged and **all prompts/decoration go to stderr**, so stdout
stays a clean data channel (`entry` JSON, `pack --json`, PR URLs stay pipeable
and byte-identical). Adds a build-time `@clack/prompts` dep (not shipped in
plugins).

## `pack` details (also enforced at install and in CI)

Included in `plugin.zip`: **only** these root files — `trek-plugin.json`,
`README.md`, `LICENSE`(.md), `package.json` — plus the **entire** `server/` and
`client/` trees. **Any other top-level file or dir is silently dropped, and
`validate` won't warn.** So bundle runtime assets (datasets, JSON) **inside
`server/` or `client/`** — a natural-looking root `data/` required as
`../data/x.json` packs clean, passes validate, then crashes with
`MODULE_NOT_FOUND` **after install**. Keep them under `server/data/…` and require
`./data/x.json`.

Watch for stray large assets: a leftover raster (e.g. a multi-MB `client/*.svg`
with an embedded photo) is shipped verbatim and bloats the artifact. Prefer
inline SVG in the client and delete unused files before packing.

Excluded: `node_modules`, `.git`, `.ts` sources, `.map` files — and **`docs/`
intentionally** (the store fetches `docs/screenshot.png` from your repo at the
pinned commit; keep it committed, out of the zip).

Every `.html` entering the zip is run through `injectTrekUi`, so a
`<!-- trek:ui -->` marker is expanded into the inlined design kit at pack time
(your source stays a one-liner).

Refused: native binaries (`.node`, `binding.gyp`, `prebuilds/`); oversize
archives. Limits: **25 MB per file, 50 MB total, 4000 entries**.

## Typical sequences

New plugin, fast path:

```bash
npx trek-plugin-sdk create my-widget --type widget
cd my-widget && npx trek-plugin-sdk dev
# … develop, fill README, commit docs/screenshot.png, push to public repo …
npx trek-plugin-sdk publish --repo you/trek-plugin-my-widget --tag v1.0.0 --sign
```

By hand (no `gh`, manual PR):

```bash
npx trek-plugin-sdk validate .
npx trek-plugin-sdk pack .
# create the GitHub release yourself, attach plugin.zip, then:
git fetch origin --tags   # if gh created the tag remotely, entry needs it locally
npx trek-plugin-sdk entry --repo you/trek-plugin-my-widget --tag v1.0.0 \
  --out registry/plugins/my-widget.json
npx trek-plugin-sdk preflight --repo you/trek-plugin-my-widget --tag v1.0.0
# fork TREK-Plugins, add ONLY that file, open the PR
```

Update (v1.1.0):

```bash
# bump "version" in trek-plugin.json to 1.1.0 first
npx trek-plugin-sdk publish --repo you/trek-plugin-my-widget --tag v1.1.0 --sign
# or manually: pack → release v1.1.0 → entry --merge existing.json → PR
```

Failure behavior worth knowing: the git tag must **equal** the manifest
`version` (v-prefixed); `entry` needs the tag **locally** — after
`gh release create` made it remotely, `git fetch origin --tags` first (or pass
`--commit <sha>`), else it fails with `could not resolve the commit for tag
"vX.Y.Z" (is it pushed?)`; `preflight`/CI fail on any gate in
[publishing.md](publishing.md#ci-gates).

## Dev-link — run your local build inside a real instance (DEV-ONLY)

`trek-plugin dev` only **mocks** the host (see [testing.md](testing.md)). The
**dev-link** path instead runs your *same local build* inside a
**real running TREK instance against real trip data** — the fidelity `dev` can't
give you. It is strictly a development tool, **gated behind an env flag and off
by default; never enable it in production** (it bypasses the signing/integrity
model, and under `npm run dev` runs with the OS permission jail **off** — though
DATA access stays fully capability-gated).

Steps:

1. **Build** the plugin so a real **`server/index.js`** exists — the loader runs
   the compiled artifact, **not** TS (`no built server/index.js` otherwise).
2. Start TREK with **`TREK_PLUGINS_DEV_LINK=1`** (accepts only exactly `1`).
3. **Admin → Plugins** shows a "link" form — paste the **absolute** path to the
   built plugin dir (or `POST /api/admin/plugins/link { path }`). The host
   validates the manifest, refuses native binaries (same guards as sideload), and
   **symlinks** `<plugins>/<id>` → your source (Windows junction, no elevation).
4. It registers **INACTIVE**, flagged **Dev-linked** (`source_repo='local:link'`,
   unsigned, sha256/pubkey nulled, **no auto-update**) — then **activate + consent**.
5. **Rebuild** → an `fs.watch` on `server/` **auto re-forks**; or hit **Reload** /
   `POST /api/admin/plugins/:id/reload` on demand.

Gotchas: the path must be **absolute** and point at **built JS** (not TS); you
**can't dev-link an id already installed** from registry/sideload (uninstall
first); a rebuilt manifest that **widens permissions forces re-consent** on
reload; and discovery only follows the symlink **while dev-link mode is on**, so a
stale link is ignored on a normal boot. The admin UI only renders the link form
when the server reports `devLink:true` (`GET /api/admin/plugins`).
