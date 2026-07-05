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
└── references/
    ├── manifest.md             # trek-plugin.json + permissions + egress
    ├── server-api.md           # definePlugin, ctx, routes, jobs
    ├── client-bridge.md        # iframe sandbox + postMessage protocol
    ├── testing.md              # dev server + createMockHost
    ├── cli.md                  # all trek-plugin CLI commands
    └── publishing.md           # releases, registry entry, CI gates, signing
```

## Install

**As a Claude Code plugin** (recommended):

```
/plugin marketplace add fbnlrz/trek-plugin-skill
/plugin install trek-plugin-dev@trek-plugin-skill
```

**As a plain skill** — copy the folder into your project or user skills
directory:

```bash
# project-level
cp -r skills/trek-plugin-dev /path/to/project/.claude/skills/

# user-level
cp -r skills/trek-plugin-dev ~/.claude/skills/
```

The skill triggers automatically when a task involves TREK plugins,
`trek-plugin-sdk`, `trek-plugin.json`, or the TREK-Plugins registry — or
invoke it explicitly with `/trek-plugin-dev`.

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
When an agent using the skill hits a claim that contradicts the real TREK source
or a running instance (or a gap that cost time), it will hand you a **ready-made
feedback block, already filled in**. Just
[open an issue](https://github.com/fbnlrz/trek-plugin-skill/issues/new/choose),
pick **📋 Paste an agent-generated report**, paste, and submit — that's the whole
job. Manual **Skill discrepancy** and **Missing guidance** forms exist too.

One thing we ask you to keep honest: the block's **Evidence** line — read in the
source, seen on a real instance, seen in `trek-plugin dev`, seen in a custom
harness (no real CSP/sandbox), or merely inferred. An inference isn't a confirmed
discrepancy; several reported "bugs" have turned out to be test-method artifacts.

## License

MIT (this skill). TREK and TREK-Plugins are licensed by their own authors.
