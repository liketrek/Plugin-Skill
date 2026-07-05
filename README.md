# trek-plugin-skill

An **agent skill** that teaches AI coding agents (Claude Code and other
SKILL.md-compatible agents) how to build, test, and publish plugins for
[TREK](https://github.com/mauriceboe/TREK) — the self-hosted travel planner —
and its community registry
[TREK-Plugins](https://github.com/mauriceboe/TREK-Plugins).

## What the agent learns

- The plugin model: `integration` / `page` / `widget`, the isolated
  child-process runtime, and the sandboxed iframe UI.
- `trek-plugin.json`: every manifest field, the full permission catalog, and
  the `http:outbound:<host>` vs `egress[]` trap.
- Server code with `definePlugin`: routes, cron jobs, the `ctx` object
  (`db`, `trips`, `users`, `ws`, `config`, `log`) and its error codes.
- The client `postMessage` bridge (`trek:ready`, `trek:context`,
  `trek:invoke`, …) and the per-plugin CSP.
- Local development and testing: `trek-plugin dev`, `dev-fixtures.json`,
  `createMockHost`.
- The whole `trek-plugin` CLI (`create`, `dev`, `validate`, `pack`, `entry`,
  `release`, `preflight`, `submit`, `publish`, `keygen`/`sign`).
- Publishing: GitHub releases, the registry entry schema, **every CI gate**
  of the TREK-Plugins repo (entry + README quality gates), signing (TOFU),
  and the update flow.

## Layout

```
skills/trek-plugin-dev/
├── SKILL.md                    # entry point: workflow, rules, decision tables
├── references/
│   ├── manifest.md             # trek-plugin.json + permissions + egress
│   ├── server-api.md           # definePlugin, ctx, routes, jobs, planner writes
│   ├── client-bridge.md        # iframe sandbox + postMessage + design kit
│   ├── testing.md              # dev server, /preview, createMockHost, dev-kit
│   ├── cli.md                  # all trek-plugin CLI commands
│   └── publishing.md           # releases, registry entry, CI gates, signing
└── assets/                     # vendorable dev-kit
    ├── setup.sh                # bootstrap the kit into a plugin repo (--web-hook)
    ├── shot.mjs                # screenshot helper → docs/screenshot.png + preview
    ├── store-shot.html         # composed store-image template (light+dark)
    ├── session-start.sh        # Claude Code web SessionStart hook
    ├── gitattributes           # reproducible plugin.zip (eol=lf)
    └── dev-fixtures.example.json
```

## Install

### Add the skill to your repo (recommended)

Committing the skill config **into the repo you build your plugin in** (e.g.
your `trek-plugin-<id>` repo) makes it load automatically for **every session
on that repo — local and Claude Code web — and for every collaborator**. Two
ways; pick one:

**Way 1 — declare the marketplace** (stays up to date automatically). Commit
this as `.claude/settings.json` in your repo root:

```json
{
  "extraKnownMarketplaces": {
    "trek-plugin-skill": {
      "source": { "source": "github", "repo": "fbnlrz/trek-plugin-skill" }
    }
  },
  "enabledPlugins": ["trek-plugin-dev@trek-plugin-skill"]
}
```

The `enabledPlugins` entry is `<plugin>@<marketplace-key>` — it must match the
key under `extraKnownMarketplaces`. Every new session then installs the latest
skill from this repo's `main`.

**Way 2 — vendor the files** (no marketplace, no network needed at session
start; you update by re-copying). Copy the skill folder into your repo —
sessions auto-load `.claude/skills/**/SKILL.md`:

```bash
git clone --depth 1 https://github.com/fbnlrz/trek-plugin-skill /tmp/tps
mkdir -p /path/to/your-repo/.claude/skills
cp -r /tmp/tps/skills/trek-plugin-dev /path/to/your-repo/.claude/skills/
cd /path/to/your-repo && git add .claude && git commit -m "Add trek-plugin-dev skill"
```

Then just start a session on the repo — done.

### Local one-off — CLI, Desktop, or IDE (user-scoped)

If you'd rather install it for **yourself** instead of a repo, the interactive
`/plugin` command works in the local CLI, Desktop app, and IDE extensions:

```
/plugin marketplace add fbnlrz/trek-plugin-skill
/plugin install trek-plugin-dev@trek-plugin-skill
```

Or copy the folder to your user skills dir: `cp -r skills/trek-plugin-dev
~/.claude/skills/`. **Note:** user-scoped installs do *not* carry into Claude
Code web sessions — for web, use the repo method above.

### Claude Code on the web (claude.ai/code)

`/plugin` is **not available in web sessions** (it opens an interactive picker) —
use **"Add the skill to your repo"** above; both ways work on the web. Web
caveats: the session's network access must be **Trusted** or **Full** so it can
reach `github.com` (Way 1); the marketplace must be on this repo's **default
branch** (it is — `main`); and start a **new** web session after committing the
config (resuming reuses cached config). Docs:
[Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) ·
[Discover plugins](https://code.claude.com/docs/en/discover-plugins).

However you install it, the skill triggers automatically when a task involves
TREK plugins, `trek-plugin-sdk`, `trek-plugin.json`, or the TREK-Plugins
registry — or invoke it explicitly with `/trek-plugin-dev`.

## Updating

This plugin is intentionally **unversioned** (its `plugin.json` has no `version`
field), so Claude Code resolves its version from the git commit — **every new
session installs the latest `main`**. You don't bump anything to get updates.

### On the web (claude.ai/code)

- **Just start a new cloud session.** A new session re-clones the repo and
  re-installs plugins from the marketplace at startup, picking up the latest
  commit. **Resuming** an existing session does *not* refresh — it keeps the
  plugins from that session's original start. There is no mid-session refresh
  (`/plugin` and `/reload-plugins` are interactive, so unavailable on the web).
- If you **vendored** the skill into `.claude/skills/` (Option B), update by
  replacing the files, committing to the default branch, and starting a new
  session — the fresh clone carries the new `SKILL.md`.
- **Want stability instead of latest?** Pin the marketplace source to a tag or
  branch in your `.claude/settings.json`, and bump the `ref` when you want the
  update:

  ```json
  {
    "extraKnownMarketplaces": {
      "trek-plugin-skill": {
        "source": { "source": "github", "repo": "fbnlrz/trek-plugin-skill", "ref": "v1.2.0" }
      }
    },
    "enabledPlugins": ["trek-plugin-dev@trek-plugin-skill"]
  }
  ```

### Local (CLI / Desktop / IDE)

```
/plugin marketplace update trek-plugin-skill    # refresh the marketplace
/plugin update trek-plugin-dev@trek-plugin-skill
```

> **Maintainer note:** because there is no `version` field, pushing to `main`
> ships to everyone on their next session. If you fork this and prefer pinned
> semver releases, add a `version` to `.claude-plugin/plugin.json` and **bump it
> on every release** — Claude Code caches a plugin whose version string didn't
> change, so an un-bumped version silently withholds updates.

## Sources

Built from the primary sources (July 2026): the
[TREK](https://github.com/mauriceboe/TREK) repo (`plugin-sdk/`, server plugin
runtime), the [TREK wiki](https://github.com/mauriceboe/TREK/wiki)
(Plugin-Development, Plugin-Permissions, Plugin-Publishing, Plugins), and the
[TREK-Plugins](https://github.com/mauriceboe/TREK-Plugins) registry (schemas,
CI scripts, koffi example). Community plugins are third-party software — see
the registry's security notes.

## Feedback & corrections

This skill is documentation verified against TREK's source — but TREK evolves.
The skill has a built-in reporting loop so fixes reach everyone.

### How the report gets generated

**Automatically:** the skill instructs the agent that whenever it hits a claim
in the skill that contradicts the real TREK source or a running instance — or a
gap that costs real time — it must fill in a standardized **Skill feedback**
block and hand it to you in a fenced code block, every field already filled
(file + section, what the skill says, what actually happens, evidence type,
citation/repro, versions, suggested fix).

**On demand:** you can also ask for one at any point in a session that uses the
skill — for example:

```
Generate a skill feedback report for what we just found
(the trek-plugin-dev skill's feedback block), filled in.
```

or, more targeted:

```
The skill says X in references/<file>.md, but we observed Y.
Fill in the skill-feedback block for this — be honest in the Evidence field.
```

### Submitting it (three steps)

1. Copy the block the agent printed.
2. Open a [new issue](https://github.com/fbnlrz/trek-plugin-skill/issues/new/choose)
   and pick **📋 Paste an agent-generated report**.
3. Paste over the template body and submit — that's the whole job.

(Manual **Skill discrepancy** and **Missing guidance** forms exist too, if you're
reporting without an agent.)

### The one honesty rule

The block's **Evidence** line matters most: read in the source, seen on a real
instance, seen in `trek-plugin dev`, seen in a custom harness (no real
CSP/sandbox), or merely inferred. An inference isn't a confirmed discrepancy —
several reported "bugs" have turned out to be test-method artifacts. Reports
with an honest Evidence line get verified against the TREK source and merged
fast (see PRs #4–#8 in this repo, several of which started as exactly such
reports).

## License

MIT (this skill). TREK and TREK-Plugins are licensed by their own authors.
