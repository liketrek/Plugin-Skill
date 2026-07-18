#!/usr/bin/env python3
"""Print the GitHub release notes for the current manifest version to stdout."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
version = json.loads((ROOT / ".codex-plugin/plugin.json").read_text())["version"]

print(f"""**Upload to Claude** — use `trek-plugin-dev-{version}.skill` in the skill
upload dialog on claude.ai. It accepts a `.zip` or `.skill` archive containing a
`SKILL.md`; both files here are byte-identical, so either works.

**Install locally** — unpack into your skills directory:

```bash
# Claude Code
unzip trek-plugin-dev-{version}.zip -d ~/.claude/skills/

# Codex
unzip trek-plugin-dev-{version}.zip -d ~/.agents/skills/
```

Or skip the download and install from the repo instead — marketplace, vendoring
and per-repo setup are covered in the
[README](https://github.com/liketrek/Plugin-Skill#install).""")
