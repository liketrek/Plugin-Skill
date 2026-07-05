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
| `create [name] [--type t] [--interactive]` | — | Scaffold a plugin. No name (or `--interactive`) → interactive wizard (id, type, author, permissions). With a name: `--type integration\|page\|widget`. |
| `dev [dir]` | — | Local dev server at `http://localhost:4317` with hot reload, SDK injection, permission-enforcing `ctx`. See [testing.md](testing.md). |
| `validate [dir]` | — | Manifest + layout checks (same manifest rules as the install loader). Fails on invalid `trek-plugin.json`, missing `README.md`, or missing `server/index.js`; warns if dir name ≠ id, README lacks a screenshot, or scaffold placeholders remain. Since `pack` validates first, a missing README also fails `pack`. **Subset of CI** — CI additionally verifies release/sha256/README over the network. |
| `pack [dir] [--out plugin.zip] [--json]` | — | Validates, then builds `plugin.zip` in the installer's exact layout; prints **sha256 + byte size**. `--json` for machine-readable output. |
| `entry --repo <owner/name> --tag <vX.Y.Z> [--zip plugin.zip] [--commit <sha>] [--asset <name>] [--merge <entry.json>] [--out <file>]` | git | Emits the ready-to-PR registry entry: resolves `commitSha` from the tag (`git rev-parse <tag>^{commit}`), fills `downloadUrl`, `sha256`, `size`, `apiVersion`, and `minTrekVersion` (lower bound of the manifest's `trek` range). `--merge` prepends the new version onto an existing entry (update case, newest-first). |
| `release [dir] --repo <o/n> --tag <vX.Y.Z> [--out] [--notes] [--commit] [--merge] [--sign]` | git + `gh` (authed) | One shot: `pack` → `gh release create` (uploads the zip) → prints the entry. |
| `preflight --repo <o/n> --tag <vX.Y.Z> [--entry <file.json>]` | network | Runs the **full registry CI locally**: tag→commit resolution, manifest parity at that commit, artifact sha256 + size, native-binary scan, README quality gate. Green preflight ⇒ green CI. |
| `submit --repo <o/n> --tag <vX.Y.Z> [--draft] [--registry <owner/name>] [--sign]` | `gh` (authed) | Forks TREK-Plugins (once), branches off `main`, writes/merges `registry/plugins/<id>.json`, pushes, opens the PR, prints its URL. |
| `publish --repo <o/n> --tag <vX.Y.Z> [--sign]` | git + `gh` (authed) | **The one-command release:** pack → tag + GitHub release → preflight → registry PR. Stops *before* submitting if preflight fails, so a broken entry never becomes a doomed PR. |
| `keygen` | — | Creates a dependency-free Ed25519 signing key at `~/.trek-plugin/signing.key` (back it up!). |
| `sign` / `--sign` on `entry`/`release`/`submit`/`publish` | key | Signs the exact artifact bytes; fills `authorPublicKey` (entry) + `signature` (version). `submit --sign` refuses an update signed with a different key than the one already listed. |

## `pack` details (also enforced at install and in CI)

Included in `plugin.zip`: `trek-plugin.json`, `README.md`, `LICENSE`(.md),
`package.json` at the root; the **entire** `server/` and `client/` trees.
Watch for stray large assets: a leftover raster (e.g. a multi-MB `client/*.svg`
with an embedded photo) is shipped verbatim and bloats the artifact. Prefer
inline SVG in the client and delete unused files before packing.

Excluded: `node_modules`, `.git`, `.ts` sources, `.map` files — and **`docs/`
intentionally** (the store fetches `docs/screenshot.png` from your repo at the
pinned commit; keep it committed, out of the zip).

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
`version` (v-prefixed); `entry` fails if the tag doesn't resolve or the zip is
missing; `preflight`/CI fail on any gate in
[publishing.md](publishing.md#ci-gates).
