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
client/               # built frontend (page/widget, and trip-page ≥3.2.1)
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

> **Reproducible artifacts (CRLF trap):** `pack` zips your **working-tree**
> files, so on Windows with `core.autocrlf=true` the same commit produces a
> **different sha256 and size** than an LF checkout. Harmless as long as you
> upload the exact zip you packed and let `entry` hash that same asset — but it
> surprises anyone re-packing on another machine or comparing hashes. For
> cross-platform reproducibility commit a `.gitattributes` with
> `* text=auto eol=lf`.

## Registry entry schema (`registry/plugins/<id>.json`)

Top level — required: `id`, `name`, `author`, `description`, `repo`, `type`,
`versions`.

| Field | Constraints |
|---|---|
| `id` | `^[a-z][a-z0-9-]{2,39}$`; must equal the filename (without `.json`). |
| `name` | 2–60 chars. |
| `author` | 1–80 chars. |
| `description` | 8–200 chars. |
| `repo` | `owner/name` (GitHub). Source of truth for the code. |
| `homepage` | Optional URI. |
| `tags` | Optional; up to 8 slugs matching `^[a-z0-9-]{2,24}$`. |
| `type` | `integration` \| `page` \| `widget` \| `trip-page` **(≥3.2.1)** — `trip-page` is now in the registry `main` schema's `type` enum (v3-2-1 was merged), so entries validate directly. |
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
| `requiredAddons` **(registry ≥ PR #13)** | Optional array (≤ 16) of addon ids (`^[a-z][a-z0-9_]{1,39}$`, e.g. `["budget"]`) that must be enabled in TREK for this version to activate. **Must mirror the manifest** (parity gate). |
| `pluginDependencies` **(registry ≥ PR #13)** | Optional array (≤ 32) of `{ id, version }` — other plugins this version needs, each pinned by a semver range (`id` `^[a-z][a-z0-9-]{2,39}$`, `version` a range string ≤ 100 chars). **Must mirror the manifest** (parity gate). |

`trek-plugin entry --repo <o/n> --tag <vX.Y.Z>` computes all derived fields;
`--merge existing.json` prepends a new version for updates. The canonical
shape is `schema/example-entry.json`; the authority is
`schema/plugin-entry.schema.json` (additionalProperties: false — no extra
keys).

> **Trap — `requiredAddons`/`pluginDependencies` are registry-ahead-of-SDK.** The
> registry (TREK-Plugins `main`, PR #13) added these fields and a **parity gate**,
> but the v3-2-1 SDK's `entry`/`buildEntry` does **not** copy them from the manifest
> into the entry, and `validateManifest` silently ignores unknown manifest keys. So
> if you declare `requiredAddons`/`pluginDependencies` in `trek-plugin.json`, you
> must **hand-add the identical arrays to the entry** or the parity gate fails
> (`manifest requiredAddons != entry requiredAddons`). If you use neither, both
> default to `[]` and you're unaffected. TREK the app does **not** yet enforce these
> at activation (no references in the 3.2.1 server) — they're declarative index
> metadata so the registry can express addon + inter-plugin deps.

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
| Dependency parity **(registry ≥ PR #13)** | The entry's `requiredAddons` or `pluginDependencies` (sorted/normalized) differ from the manifest's at `commitSha` — including the common case where you declared them in the manifest but the SDK's `entry` didn't copy them, so the entry has `[]` | Hand-add the identical `requiredAddons`/`pluginDependencies` arrays to the entry |
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

## When `submit` / `publish` can't open the PR (do it by hand)

The automated PR step can fail with **`error: remote upstream already exists`**
(still present as of TREK 3.2.1 / SDK 1.3.0 — `submit.ts` is unchanged).
Cause (confirmed in `src/cli/submit.ts`): `submit` clones your fork with
`gh repo clone`, which auto-adds an `upstream` remote for a fork, then
unconditionally runs `git remote add upstream …` again. The **release itself is
already done** at that point — only the PR is missing. Open the one-file PR
manually:

```bash
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

## Updates

1. Bump `version` in `trek-plugin.json`; develop; re-`pack`.
2. New tag + release `vX.Y.Z` with the new `plugin.zip`.
3. `trek-plugin entry --repo <o/n> --tag <vX.Y.Z> --merge registry/plugins/<id>.json --out registry/plugins/<id>.json`
   (prepends; array stays newest-first) — or `publish`, which handles it.
4. PR the updated file.

Instances see updates on their next registry poll; applying one is an explicit
admin action, and **if the new version requests more permissions the admin
must re-approve**.

## Semantics of `Reviewed`

`reviewedAt` means a maintainer manually scanned **that exact commit** for
malware on that date — not functionality, not an ongoing guarantee, and not an
endorsement. It is stamped by CI on merge.
