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
client/               # built frontend (page/widget only)
README.md             # must pass the quality gate (below)
docs/screenshot.png   # store card image — committed, NOT shipped in the zip
```

Release rule: tag `vX.Y.Z` where `X.Y.Z` **equals** the manifest `version`,
with the packed `plugin.zip` attached as a release asset. Use the uploaded
asset, never GitHub's auto-generated source archives (wrong layout, unstable
bytes). The registry pins the asset's **sha256** — released bytes are
immutable in practice; fix things in a new version.

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
| `type` | `integration` \| `page` \| `widget`. |
| `authorPublicKey` | Optional base64 minisign/Ed25519 public key, 40–120 chars; stable across versions; TOFU-pinned on first install. |
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
| `signature` | Optional base64 minisign signature over the artifact bytes; requires `authorPublicKey` on the entry. |
| `publishedAt` | Optional ISO date-time. |

`trek-plugin entry --repo <o/n> --tag <vX.Y.Z>` computes all derived fields;
`--merge existing.json` prepends a new version for updates. The canonical
shape is `schema/example-entry.json`; the authority is
`schema/plugin-entry.schema.json` (additionalProperties: false — no extra
keys).

## CI gates

Every PR runs `scripts/validate-entry.mjs` and `scripts/check-readme.mjs` on
each changed `registry/plugins/*.json`. Each is a hard gate; `preflight`
replays all of them locally. On merge, `publish.yml` regenerates
`dist/index.json` and stamps `reviewedAt` — **a PR must only add/change your
one entry file, never `dist/`**.

### Entry gates (`validate-entry.mjs`)

| Gate | Fails when | Fix |
|---|---|---|
| JSON schema | Entry violates `plugin-entry.schema.json` (incl. unknown keys) | Regenerate with `trek-plugin entry` |
| id ↔ filename | `id` ≠ filename or not a valid slug | Rename file / fix id |
| Owner binding | Existing id repointed to a different owner (per `OWNERS.json`: id → `{ boundOwner, repo }`, stamped on first merge) | Only the bound owner can update; owner change needs a maintainer override |
| Homoglyph / mixed-script | `name` uses confusable/mixed-script characters | Use plain characters |
| Release tag | `gitTag` doesn't exist or doesn't resolve to `commitSha` | Push the tag; re-run `entry` |
| Manifest parity | `id`/`version`/`type`/`apiVersion` in the repo's `trek-plugin.json` **at `commitSha`** differ from the entry, or manifest has `nativeModules: true` | Align manifest and entry; retag |
| Artifact hash/size | Downloaded release asset's SHA-256 ≠ `sha256`, or size out of bounds | Never touch released assets; cut a new version |
| Native binary scan | `.node` binaries (or similar) inside the zip | Remove native deps; repack |
| Egress | Any `http:outbound*` permission but `egress[]` missing/empty, or `egress` contains a bare `*` | Declare explicit hosts |
| Signature | `signature` present but doesn't verify against `authorPublicKey` | Re-sign the exact artifact bytes |

(The reserved ids `registry`, `install`, `rescan` are refused by **TREK's
install loader** — they collide with admin API route segments — not by the
registry CI script. Avoid them regardless: a listed plugin nobody can install
is pointless.)

### README gates (`check-readme.mjs`, fetched from your repo at the pinned commit)

| Gate | Requirement |
|---|---|
| Exists | `README.md` at the repo root |
| Sections | Headings **What it does**, **Screenshots**, **Permissions**, **Setup** all present |
| Screenshot | At least one image reference that **resolves to a real image** (relative paths like `docs/screenshot.png` resolved against the pinned commit) |
| Real prose | >= 400 characters after stripping headings/code/images/tables — a template stub fails |
| Placeholders | No leftover `{{placeholder}}` tokens from the scaffold |
| Permission parity | **Every permission string declared in the manifest appears in the README** with an explanation |

Model README: `plugin-sdk/examples/koffi/README.md` (TREK repo) — note its
Permissions section is a table with one row per permission explaining why.

## Signing (optional, recommended)

`sha256` proves the registry-vouched bytes; a signature additionally proves
**you** built them (a compromised registry can't ship attacker code under your
name). Verified offline (minisign/Ed25519); key pinned on first install
(trust-on-first-use).

SDK path (no minisign needed):

```bash
npx trek-plugin-sdk keygen        # once → ~/.trek-plugin/signing.key (BACK IT UP)
npx trek-plugin-sdk publish --repo you/repo --tag v1.2.0 --sign
```

Manual path: `minisign -G`, put the base64 payload of `minisign.pub` into
`authorPublicKey`; per release `minisign -Sm plugin.zip` and put the base64
`.minisig` payload into that version's `signature`.

Rules: the key must stay **stable across versions**; once a plugin has shipped
signed, an unsigned or re-keyed update is refused until an admin explicitly
re-trusts (`submit --sign` guards against accidental key switches). Unsigned
plugins install on sha256 alone.

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
