# Publishing — releases, registry entries, CI gates

Distribution model: the [TREK-Plugins](https://github.com/mauriceboe/TREK-Plugins)
repo is a **static index**. Instances fetch one file, `dist/index.json`. Your
code, README, screenshots, and release artifacts live in **your own public
GitHub repo** (convention: `trek-plugin-<id>`); the registry stores only one
metadata file per plugin: `registry/plugins/<id>.json`. Listing = opening a PR
that adds/updates exactly that file. No server, no account.

## Publishable repo layout (repo root)

```
trek-plugin.json      # manifest
package.json          # "type": "commonjs"; SDK as devDependency at most
server/index.js       # built server entry (required)
client/               # built frontend (page/widget/trip-page)
README.md             # must pass the quality gate (below)
docs/screenshot.png   # store card image — committed, NOT shipped in the zip
```

> Only those root files (`trek-plugin.json` / `README.md` / `package.json` /
> `LICENSE`) **plus the full `server/` and `client/` trees** are packed. **Any
> other top-level dir (e.g. `data/`) is silently excluded** and `validate` won't
> warn — bundle runtime assets *inside* `server/` or `client/`, or they'll be
> missing at runtime after install.

Release rule: tag `vX.Y.Z` where `X.Y.Z` **equals** the manifest `version`,
with the packed `plugin.zip` attached as a release asset. Use the uploaded
asset, never GitHub's auto-generated source archives (wrong layout, unstable
bytes). The registry pins the asset's **sha256** — released bytes are
immutable in practice; fix things in a new version.

> **Remote-only tag trap:** if you let `gh release create vX.Y.Z …` create the
> tag (instead of tagging locally and pushing), the tag exists **only on
> GitHub** — your local repo doesn't have it, and a following `entry`/`release`
> fails with `could not resolve the commit for tag "vX.Y.Z" (is it pushed?)`.
> Run **`git fetch origin --tags`** between the release and `entry`, or pass
> `--commit <sha>` to override.

> **Take `sha256`/`size` from the uploaded asset, never from a local re-pack.**
> The registry pin must describe **the exact bytes attached to the GitHub
> release**: upload the zip you packed, then build the entry **after** the
> upload against that same artifact — or verify by hand:
> `curl -fsSL <downloadUrl> | sha256sum` and the asset's exact byte count.
> The SDK's zip writer stamps **fixed mod dates (1980-01-01)**, so packing is
> deterministic for a given SDK on a given machine — but re-packs elsewhere can
> still differ: **CRLF checkouts** change file bytes (fix: commit a
> `.gitattributes` with `* text=auto eol=lf`), the **directory walk order** is
> filesystem-dependent, and **older/newer SDK versions** produce different zip
> layouts (1.3.0 vs 1.3.1 famously differed by 88 bytes on identical sources).
> Never assume a local hash matches the released asset — check the asset.

## Registry entry schema (`registry/plugins/<id>.json`)

Top level — required: `id`, `name`, `author`, `description`, `repo`, `type`,
`versions`.

| Field | Constraints |
|---|---|
| `id` | `^[a-z][a-z0-9-]{2,39}$`; must equal the filename (without `.json`). |
| `name` | 2–60 chars. |
| `author` | 1–80 chars. |
| `description` | 8–200 chars — **the cap binds the *entry*, not the manifest, and the two need not match.** Manifest parity compares only `id`/`version`/`type`/`apiVersion`/`nativeModules` (+ dependency fields), never `description` — a merged entry with a short description alongside a longer manifest description is confirmed fine. ⚠️ But `buildEntry` copies the manifest description **verbatim**, and `validate`/`pack` don't enforce the cap — so a > 200-char manifest description sails through pack + release and only then **fails registry CI** (`description must NOT have more than 200 characters`). Either keep `trek-plugin.json`'s description ≤ 200 chars, or hand-shorten the entry's `description` after `entry` (allowed). |
| `repo` | `owner/name` (GitHub). Source of truth for the code. |
| `homepage` | Optional URI. |
| `tags` | Optional; up to 8 slugs matching `^[a-z0-9-]{2,24}$`. |
| `type` | `integration` \| `page` \| `widget` \| `trip-page` — all four are in the registry schema's `type` enum, validated by CI and local `preflight` alike. |
| `authorPublicKey` | Optional base64 **raw Ed25519** public key (the 32-byte key; schema allows 40–120 chars). Stable across versions; TOFU-pinned on first install. |
| `reviewedAt`, `boundOwner` | **CI-maintained — never set these yourself.** |
| `versions` | Array, min 1, **newest first**. |

Per version — required: `version`, `gitTag`, `commitSha`, `downloadUrl`,
`sha256`, `minTrekVersion`, `size`, `apiVersion`, `nativeModules`.

| Field | Constraints |
|---|---|
| `version` | Semver (pre-release allowed). |
| `gitTag` | The release tag (e.g. `v1.0.0`). |
| `commitSha` | 40-hex commit the tag resolves to (tags are movable; the commit pins what was reviewed). |
| `downloadUrl` | Must start with `https://github.com/`, `https://codeload.github.com/`, or `https://objects.githubusercontent.com/`. |
| `sha256` | 64-hex of the exact artifact bytes. |
| `minTrekVersion` | `x.y.z` — derived from the manifest's `trek` range lower bound. |
| `maxTrekVersion` | `x.y.z` or `null`. |
| `size` | Bytes, 1 … 52 428 800 (50 MB). **Required — a common omission when hand-writing.** |
| `apiVersion` | Integer >= 1. |
| `nativeModules` | Literally `false` (const). |
| `signature` | Optional base64 **raw Ed25519** signature (the 64-byte sig) over the artifact bytes; requires `authorPublicKey` on the entry. |
| `publishedAt` | Optional ISO date-time. |
| `requiredAddons` | Optional array (≤ 16) of addon ids (`^[a-z][a-z0-9_]{1,39}$`, e.g. `["budget"]`) that must be enabled in TREK for this version to activate. **Must mirror the manifest** (parity gate). |
| `pluginDependencies` | Optional array (≤ 32) of `{ id, version }` — other plugins this version needs, each pinned by a semver range (`id` `^[a-z][a-z0-9-]{2,39}$`, `version` a range string ≤ 100 chars). **Must mirror the manifest** (parity gate). |

`trek-plugin entry --repo <o/n> --tag <vX.Y.Z>` computes all derived fields;
`--merge existing.json` prepends a new version for updates. The canonical
shape is `schema/example-entry.json`; the authority is
`schema/plugin-entry.schema.json` (additionalProperties: false — no extra
keys).

> **Trap — the SDK's `entry` does NOT copy `requiredAddons`/`pluginDependencies`.**
> `buildEntry` fills only `homepage`/`tags`/`authorPublicKey` beyond the core
> fields, so if you declare `requiredAddons`/`pluginDependencies` in
> `trek-plugin.json` you must **hand-add the identical arrays to the entry** or
> the registry's parity gate fails
> (`manifest requiredAddons != entry requiredAddons`). If you use neither, both
> default to `[]` and you're unaffected. Unlike the registry metadata of the
> past, **TREK enforces these at activation**: a plugin whose required addon is
> disabled (or whose plugin dependency is missing/mismatched) can't activate,
> disabling an addon cascades to dependent plugins, and dependency cycles are
> rejected (`dependencies.ts`).

## CI gates

Every PR runs `scripts/validate-entry.mjs` and `scripts/check-readme.mjs` on
each changed `registry/plugins/*.json` (both on **Node 20**). Each is a hard
gate; `preflight` replays them locally. On merge, `publish.yml` regenerates
`dist/index.json` (plugins sorted by `id`, each `versions[]` newest-first, plus a
`dist/index.json.sha256` sidecar) and stamps `reviewedAt` — **a PR must only
add/change your one entry file, never `dist/`**.

### Entry gates (`validate-entry.mjs`)

Runs for **every** `versions[]` entry (not just the one you add) over the
network — re-listing with a broken *old* version can fail CI. (`SKIP_NETWORK=1`
runs schema/format checks only.)

| Gate | Fails when | Fix |
|---|---|---|
| JSON schema | Entry violates `plugin-entry.schema.json` (incl. unknown keys) | Regenerate with `trek-plugin entry` |
| id ↔ filename | `id` ≠ filename or not a valid slug | Rename file / fix id |
| Owner binding | Existing id repointed to a different owner (`OWNERS.json`: id → `{ boundOwner, repo }`, stamped on first merge) | Only the bound owner updates it; an owner change needs a maintainer to re-run CI with `ALLOW_OWNER_CHANGE=1` |
| Homoglyph / mixed-script | `name` mixes Latin `[A-Za-z]` **with** Cyrillic (U+0400–04FF) or Greek U+0370–037F. Only fires on a *mix* — an all-Cyrillic name, or a Latin+common-Greek (Α/Ο/α…) spoof, is **not** caught | Use plain ASCII |
| Release tag | `gitTag` doesn't exist or doesn't resolve to `commitSha` | Push the tag; re-run `entry` |
| Manifest parity | `id`/`version`/`type`/`apiVersion`/`nativeModules` in the repo's `trek-plugin.json` **at `commitSha`** differ from the entry (or `nativeModules: true`) | Align manifest and entry; retag |
| Dependency parity | The entry's `requiredAddons` or `pluginDependencies` (sorted/normalized) differ from the manifest's at `commitSha` — including the common case where you declared them in the manifest but the SDK's `entry` didn't copy them, so the entry has `[]` | Hand-add the identical `requiredAddons`/`pluginDependencies` arrays to the entry |
| Artifact hash / over-size | Downloaded asset's SHA-256 ≠ `sha256`, or the bytes are **> ~4 KB larger** than declared `size` (`buf.length > size + 4096`) — no lower-bound check; the 1–50 MB range is a separate *schema* check on the declared `size` | Never touch released assets; cut a new version |
| Native binary scan | `.node`, `binding.gyp`, or a `prebuild(s)/` path inside the artifact (**zip or tar.gz**) | Remove native deps; repack |
| Egress | Any `http:outbound*` permission but `egress[]` missing/empty, or `egress` contains a bare `*` | Declare explicit hosts |

**No signature gate.** `validate-entry.mjs` does **not** verify signatures — only
the SHA-256 pin. A `signature`/`authorPublicKey` is shape-checked by the schema
and verified by **TREK at install time (TOFU)**, not in PR CI. (The registry
README claims it's "verified when present"; the code doesn't do it.)

(Reserved ids `registry`, `install`, `rescan` are refused by **TREK's install
loader** — they collide with admin API route segments — not by the CI script.
Avoid them regardless.)

### README gates (`check-readme.mjs`, fetched from your repo at the pinned commit)

| Gate | Requirement |
|---|---|
| Exists | `README.md` at the repo root |
| Sections | Tokens **What it does**, **Screenshots**, **Permissions**, **Setup** — each matched **case-insensitively as a substring of any heading, level 1–6** (so `## Setup instructions` or `# Screenshots & demo` count) |
| Screenshot | At least one image whose URL **resolves via a live `GET`** (first 2 KB) with HTTP `Content-Type: image/*`. **`data:` URIs are ignored** (you need a committed file, e.g. `docs/screenshot.png`); `github.com/.../blob/...` links are auto-rewritten to `raw`; relative paths resolve against the pinned commit |
| Real prose | ≥ **400 characters** after stripping headings/code/images/tables/links/HTML comments — a template stub fails |
| Placeholders | No leftover scaffold placeholders: `{{…}}`, `REPLACE_ME`, template prose starting `Describe what/the …`, or a literal `your-name/trek-plugin` path |
| Permission parity | **Every permission string in the manifest appears (case-insensitive substring) in the README** — a plain substring test, not proof of a real explanation, but explain each anyway |

Model README: `plugin-sdk/examples/koffi/README.md` (TREK repo) — note its
Permissions section is a table with one row per permission explaining why.

### Store preview image (`docs/screenshot.png`)

CI enforces **no dimensions** — `check-readme.mjs` only checks that an image
reference in the README resolves to a real image at the pinned commit. Size it
for how the store renders it. The client's `Screenshot` component
(`AdminPluginsPanel.tsx`) uses `object-cover` (scales to fill, **crops**,
centres) in two different boxes:

* **Discover card:** `aspect-[16/10]` container.
* **Detail popup:** `aspect-[16/9]` container.

So ship a **16:9 image (e.g. 1600×900** — what the published `trek-plugin-koffi`
repo uses): the detail popup shows it in full, while the 16:10 card crops a
little off the **left/right**. Keep the hero/mascot and any key content
**centred** so the card crop never cuts it. Commit it under `docs/`; it is
fetched from your repo at the pinned commit and is intentionally **not** shipped
in `plugin.zip`. (The SDK's in-repo `examples/koffi` screenshot is a much wider
~1226×369 banner — fine as a repo illustration, but a true 16:9 fills the store
card cleanly.)

Because the frame can only draw inline SVG or `data:`/`blob:` images (no bundled
raster files by path, no external URLs — see
[client-bridge.md](client-bridge.md)), a clean way to make this image is to
render your inline-SVG artwork large and centred and screenshot it via the host
harness in [testing.md](testing.md).

For a **functional widget** (not a mascot), "your artwork" *is* the widget — and
a lone widget on a blank background passes CI but fills the 16:9 card poorly
(mostly empty). Compose the shot instead: place the widget(s) in a **titled
background with real colour that fits the plugin** (a mesh of its own accent hues
+ optional subtle texture, tagline, and a couple of feature pills — plain CSS/SVG
in the harness page, which is *not* under the frame CSP; don't leave it a flat
pale gradient), and show
**light + dark (and, if useful, two data states) at once** via the per-iframe
multi-context recipe in [testing.md](testing.md#one-screenshot-multiple-themesstates).
Keep the composition centred for the card crop. A ready-to-edit template that
produces exactly this shot ships with the skill:
[`assets/store-shot.html`](../assets/store-shot.html).

## Signing (optional, recommended)

`sha256` proves the registry-vouched bytes; a signature additionally proves
**you** built them (a compromised registry can't ship attacker code under your
name). The SDK produces and TREK verifies a **bare Ed25519** key + signature —
**not minisign's framed format**: `authorPublicKey` is base64 of the raw 32-byte
public key, each `signature` is base64 of the raw 64-byte signature over the
artifact bytes. Verified offline, key pinned on first install (TOFU). **Registry
CI does not verify it — only TREK at install time does.**

Use the SDK (do **not** hand-run `minisign` — its `.pub`/`.minisig` payloads are
the wrong length, 42/74 bytes, and fail the SDK/server's `length === 32/64`
checks):

```bash
npx trek-plugin-sdk keygen        # once → ~/.trek-plugin/signing.key (BACK IT UP)
npx trek-plugin-sdk publish --repo you/repo --tag v1.2.0 --sign
```

`keygen`/`sign` accept `--key <file>`; `--sign` on `entry`/`release`/`submit`/
`publish` writes `authorPublicKey` + `signature` into the entry (the standalone
`sign [zip]` command only **prints** them).

Rules: the key must stay **stable across versions**. When merging onto an
already-published entry, **both `entry --merge` and `submit` refuse** (a) a
different signing key and (b) an *unsigned* update to a previously-signed plugin.
Unsigned plugins install on sha256 alone.

## Opening the PR by hand (when `submit` / `publish` can't)

`submit` normally handles the PR itself: it forks the registry
(`--clone=false`), clones **your fork** fresh into a temp dir (retrying while
the fork initializes), branches off the current upstream `main`, writes/merges
the entry, pushes, and opens the PR. If that step fails in your environment
(no `gh` auth, restricted network, corporate proxy), the **release itself is
already done** at that point — only the PR is missing. Open the one-file PR
manually:

```bash
# 0. The GitHub release for the tag — WITH plugin.zip attached — must already
#    exist: `entry` verifies against the release asset and fails with
#    "artifact not found" if the asset isn't uploaded yet. Order is always
#    pack → release (asset attached) → entry, never entry first.
# 1. Generate the entry INSIDE the plugin repo — `entry` resolves commitSha via
#    `git rev-parse <tag>`, so the tag must be local here. If gh created the
#    tag remotely, fetch it first:
cd my-plugin
git fetch origin --tags
npx trek-plugin-sdk entry --repo you/my-plugin --tag v1.0.0 --out entry.json

# 2. Fork + clone the registry (the fork clone gets `upstream` automatically;
#    omit --remote — gh rejects it when a repo argument is given):
cd ..
gh repo fork mauriceboe/TREK-Plugins --clone
cd TREK-Plugins && git checkout -b add-<id>

# 3. Drop the entry at the required path and PR ONLY that one file:
mkdir -p registry/plugins
cp ../my-plugin/entry.json registry/plugins/<id>.json
git add registry/plugins/<id>.json
git commit -m "Add <id>"
git push -u origin add-<id>
gh pr create --repo mauriceboe/TREK-Plugins --fill
```

Manual-path snags:

- **Fork/clone already exists:** `gh repo fork mauriceboe/TREK-Plugins --clone`
  fails (`already exists … not an empty directory`, exit 128) if you forked or
  cloned before. Reuse the existing clone instead: `cd TREK-Plugins && git fetch
  upstream main && git checkout -B add-<id> upstream/main` (or `gh repo sync`).
- **PowerShell 5.1 has no `&&`** — it's a parser error, so a chained
  `git tag … && git push …` runs *neither* command (which is exactly how you end
  up without a local tag → the remote-only-tag trap above). Run the commands on
  separate lines, or use PowerShell 7+.

Prerequisite `submit`/`publish`/`release` assume silently: **`gh` installed and
authenticated** (`gh auth status`). A `spawnSync gh ENOENT` means `gh` isn't on
PATH (Windows: `winget install --id GitHub.cli -e`, then reopen the shell).

## Updating a published plugin

1. Bump `version` in `trek-plugin.json`; develop; re-`pack`.
2. New tag + GitHub release `vX.Y.Z` with the new `plugin.zip` **attached before
   anything else** — `entry` verifies the release asset and fails with
   `artifact not found` if it doesn't exist yet.
3. `trek-plugin entry --repo <o/n> --tag <vX.Y.Z> --merge registry/plugins/<id>.json --out registry/plugins/<id>.json`
   (prepends; array stays newest-first) — or `publish`, which handles it.
4. PR the updated **single** file.

### Hand-editing an existing entry (works for every type)

Start from the **merged** file in TREK-Plugins `main` (not a stale local copy),
then:

- **Prepend** the new version object at the **top** of `versions[]` (newest
  first) and **keep every old version block untouched** — CI re-validates *all*
  of them, and old released bytes are immutable anyway.
- Fill the new block **from the uploaded release asset**, never a local
  re-pack (hashes aren't reproducible — see the artifact note above):
  `sha256` = `curl -fsSL <downloadUrl> | sha256sum`, `size` = the asset's exact
  byte count (`curl -sIL <downloadUrl> | grep -i content-length`),
  `commitSha` = `git rev-parse vX.Y.Z^{commit}`, plus `gitTag`, `downloadUrl`,
  `minTrekVersion`, `apiVersion`, `nativeModules: false`.
- **Leave `reviewedAt` and `boundOwner` exactly as they are in the merged
  entry** — CI maintains them; don't delete, don't update. And never touch
  `dist/`.
- Top-level fields (`description`, `tags`, `homepage`, …) may change in the
  same PR; the entry `description` need not match the manifest (schema table
  above).

Instances see updates on their next registry poll; applying one is an explicit
admin action, and **if the new version requests more permissions the admin
must re-approve**.

## Semantics of `Reviewed`

`reviewedAt` means a maintainer manually scanned **that exact commit** for
malware on that date — not functionality, not an ongoing guarantee, and not an
endorsement. It is stamped by CI on merge.
