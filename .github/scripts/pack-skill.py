#!/usr/bin/env python3
"""Package the skill for distribution.

Produces dist/<skill>-<version>.zip containing a single top-level directory with
SKILL.md at its root — the layout the skill upload dialog on claude.ai requires,
and what you get by unzipping into ~/.claude/skills or ~/.agents/skills.

A byte-identical .skill copy is written alongside it. The upload dialog accepts
either extension; .skill is the one it names first, so it is the friendlier
thing to hand someone.

The archive is reproducible — entries are sorted and every timestamp is pinned,
so the same input always yields the same sha256.
"""

import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = sys.argv[1] if len(sys.argv) > 1 else "trek-plugin-dev"

# Fixed timestamp (2020-01-01) so archive bytes don't drift between builds.
EPOCH = (2020, 1, 1, 0, 0, 0)

src = ROOT / "skills" / SKILL
if not (src / "SKILL.md").is_file():
    sys.exit(f"✗ skills/{SKILL}/SKILL.md not found")

version = json.loads((ROOT / ".codex-plugin/plugin.json").read_text())["version"]

dist = ROOT / "dist"
if dist.exists():
    shutil.rmtree(dist)
dist.mkdir()

zip_path = dist / f"{SKILL}-{version}.zip"
files = sorted(p for p in src.rglob("*") if p.is_file())

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for path in files:
        # Store as "<skill>/…" so the archive unpacks into its own directory.
        info = zipfile.ZipInfo(str(path.relative_to(src.parent)), date_time=EPOCH)
        info.compress_type = zipfile.ZIP_DEFLATED
        # Preserve the executable bit on scripts; everything else 644.
        mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
        info.external_attr = mode << 16
        z.writestr(info, path.read_bytes())

skill_path = dist / f"{SKILL}-{version}.skill"
shutil.copyfile(zip_path, skill_path)

print(f"✔ {zip_path.relative_to(ROOT)} ({zip_path.stat().st_size:,} bytes, {len(files)} files)")
print(f"✔ {skill_path.relative_to(ROOT)} (identical bytes; upload either one to claude.ai)")
for path in files:
    print(f"   {path.relative_to(src.parent)}")
