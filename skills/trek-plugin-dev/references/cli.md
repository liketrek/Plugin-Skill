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
| `create [name] [--type t] [--author x] [--description x] [--permissions "a,b"] [--interactive]` | — | Scaffold a plugin. No name (or `--interactive`) → a **Clack wizard** (id, **location**, type, author, **description**, multiselect permissions, and — if `http:outbound` is picked — **egress hosts**), then offers `git init` + `npm install`. With a name it's non-interactive and still requires the name. **≥1.3.0:** page/widget scaffold emits a **design-kit client** (`<!-- trek:ui -->` marker + a `window.trek` UI). |
| `dev [dir] [--port 4317]` | — | Local dev server (default `http://localhost:4317`) with hot reload, SDK injection, permission-enforcing `ctx`. **≥1.3.0:** also serves a themed host preview at **`/preview`** and expands the `<!-- trek:ui -->` marker on `/ui`. See [testing.md](testing.md). |
| `validate [dir]` | — | Manifest + layout checks (same manifest rules as the install loader). Fails on invalid `trek-plugin.json`, missing `README.md`, or missing `server/index.js`; warns if dir name ≠ id, README lacks a screenshot, or scaffold placeholders remain. Since `pack` validates first, a missing README also fails `pack`. **Subset of CI** — CI additionally verifies release/sha256/README over the network. |
| `pack [dir] [--out plugin.zip] [--json]` | — | Validates, then builds `plugin.zip` in the installer's exact layout; prints **sha256 + byte size**. `--json` for machine-readable output. |
| `entry [dir] --repo <owner/name> --tag <vX.Y.Z> [--dir d] [--zip plugin.zip] [--commit <sha>] [--asset <name>] [--merge <entry.json>] [--out <file>] [--sign [key]]` | git | Emits the ready-to-PR registry entry: resolves `commitSha` from the tag (`git rev-parse <tag>^{commit}`), fills `downloadUrl`, `sha256`, `size`, `apiVersion`, `minTrekVersion`. `--merge` prepends the new version (newest-first) and refuses a key switch / unsigned update to a signed plugin. |
| `release [dir] --repo <o/n> --tag <vX.Y.Z> [--out] [--notes] [--commit] [--merge] [--sign [key]]` | git + `gh` (authed) | One shot: `pack` → `gh release create` (uploads the zip) → prints the entry. |
| `preflight [dir] --repo <o/n> --tag <vX.Y.Z> [--all] [--entry <file.json>] [--zip] [--commit] [--sign]` | network | Runs the **full registry CI locally**: tag→commit, manifest parity, artifact sha256 + size, native scan, README gate. **Default checks only the newest version; `--all` checks every `versions[]`.** Green preflight ⇒ green CI. |
| `submit --repo <o/n> --tag <vX.Y.Z> [--branch <name>] [--keep] [--draft] [--registry <owner/name>] [--zip] [--commit] [--sign [key]]` | `gh` (authed) | Forks TREK-Plugins (once), branches (`plugin-<id>-<version>` unless `--branch`), writes/merges the entry, pushes, opens the PR. `--keep` keeps the temp clone dir. |
| `publish --repo <o/n> --tag <vX.Y.Z> [--sign [key]] [--no-preflight] [--draft] [--registry <owner/name>] [--notes <text>]` | git + `gh` (authed) | **One-command release:** pack → tag + GitHub release → preflight → registry PR. Stops before submitting if preflight fails — **`--no-preflight` skips that safety gate** (don't). |
| `keygen [--key <file>]` | — | Creates a dependency-free Ed25519 signing key (default `~/.trek-plugin/signing.key`; back it up!). |
| `sign [zip] [--key <file>]` | key | **Prints** `signature` + `authorPublicKey` for an artifact (default `plugin.zip`) — does **not** modify any entry. |

`--sign [key]` on `entry`/`release`/`submit`/`publish` is what actually **writes**
`authorPublicKey` + `signature` into the generated entry (default key
`~/.trek-plugin/signing.key`, or an inline path / `--key`). `submit`/`entry
--merge` refuse a *different* key or an *unsigned* update to a signed plugin.

## Interactive mode (SDK ≥ 1.3.0 / TREK ≥ 3.2.1)

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

Included in `plugin.zip`: `trek-plugin.json`, `README.md`, `LICENSE`(.md),
`package.json` at the root; the **entire** `server/` and `client/` trees.
Watch for stray large assets: a leftover raster (e.g. a multi-MB `client/*.svg`
with an embedded photo) is shipped verbatim and bloats the artifact. Prefer
inline SVG in the client and delete unused files before packing.

Excluded: `node_modules`, `.git`, `.ts` sources, `.map` files — and **`docs/`
intentionally** (the store fetches `docs/screenshot.png` from your repo at the
pinned commit; keep it committed, out of the zip).

**≥1.3.0:** every `.html` entering the zip is run through `injectTrekUi`, so a
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
