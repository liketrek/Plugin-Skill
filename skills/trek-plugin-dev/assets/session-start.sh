#!/usr/bin/env bash
# SessionStart hook — get a TREK plugin repo dev-ready in a fresh session
# (e.g. Claude Code on the web, where the container is re-cloned each session).
# Idempotent and fast; safe to run on every session start.
#
# Installed by setup.sh --web-hook into .claude/hooks/plugin-dev.sh and wired into
# .claude/settings.json under hooks.SessionStart.
set -eu
cd "${CLAUDE_PROJECT_DIR:-.}"

# Only act inside a plugin repo.
[ -f trek-plugin.json ] || exit 0

# Install deps once (trek-plugin-sdk + playwright come from devDependencies) so the
# agent can immediately `npm run dev` and `npm run shot`. Chromium is preinstalled
# in Claude Code environments — no `playwright install` needed.
if [ -f package.json ] && [ ! -d node_modules ]; then
  echo "[plugin-dev] installing dependencies…"
  npm install --no-audit --no-fund >/dev/null 2>&1 || npm install || true
fi

echo "[plugin-dev] ready — npm run dev · npm run shot · npm run preview-shot"
