#!/usr/bin/env bash
# setup.sh — vendor the TREK plugin dev-kit into your plugin repo.
#
# Adds:
#   scripts/shot.mjs + scripts/store-shot.html  (screenshot helper + store composer)
#   .gitattributes                              (reproducible plugin.zip — LF)
#   dev-fixtures.json                           (dev server fixtures, if absent)
#   devDependencies trek-plugin-sdk + playwright, and npm scripts dev/shot/preview-shot
#   with --web-hook:  a SessionStart hook so Claude Code web sessions auto-install deps
#
# Run from your plugin repo root (it must already contain trek-plugin.json — scaffold
# one first with `npx trek-plugin-sdk create`). Then:
#   bash <skill>/assets/setup.sh            # dev-kit only
#   bash <skill>/assets/setup.sh --web-hook # + the web SessionStart hook
set -eu
SELF="$(cd "$(dirname "$0")" && pwd)"

[ -f trek-plugin.json ] || {
  echo "error: no trek-plugin.json here — run this in a plugin repo root."
  echo "       scaffold one first:  npx trek-plugin-sdk create"
  exit 1
}

mkdir -p scripts docs
cp "$SELF/shot.mjs" scripts/shot.mjs
cp "$SELF/store-shot.html" scripts/store-shot.html
[ -f .gitattributes ]   || cp "$SELF/gitattributes" .gitattributes
[ -f dev-fixtures.json ] || cp "$SELF/dev-fixtures.example.json" dev-fixtures.json

# devDependencies + convenience npm scripts (best-effort; needs npm).
npm pkg set devDependencies.trek-plugin-sdk="latest" devDependencies.playwright="latest" >/dev/null 2>&1 || true
npm pkg set scripts.dev="trek-plugin-sdk dev ." \
            scripts.shot="node scripts/shot.mjs" \
            scripts.preview-shot="node scripts/shot.mjs --preview" >/dev/null 2>&1 || true
echo "installing devDependencies…"
npm install >/dev/null 2>&1 || npm install || echo "  (npm install failed — run it yourself)"

if [ "${1:-}" = "--web-hook" ]; then
  mkdir -p .claude/hooks
  cp "$SELF/session-start.sh" .claude/hooks/plugin-dev.sh
  chmod +x .claude/hooks/plugin-dev.sh
  node -e '
    const fs=require("fs"), p=".claude/settings.json";
    const s = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,"utf8")) : {};
    s.hooks = s.hooks || {}; s.hooks.SessionStart = s.hooks.SessionStart || [];
    const cmd = ".claude/hooks/plugin-dev.sh";
    if (!JSON.stringify(s.hooks.SessionStart).includes(cmd))
      s.hooks.SessionStart.push({ hooks: [{ type: "command", command: cmd }] });
    fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  '
  echo "installed SessionStart hook (.claude/hooks/plugin-dev.sh) — web sessions auto-install deps."
fi

# Never let the harness ship: shot.mjs copies store-shot.html into client/ only for the
# duration of a shot and deletes it, but guard the source copy too.
grep -q "^client/harness.html" .gitignore 2>/dev/null || echo "client/harness.html" >> .gitignore

echo
echo "done. Next:"
echo "  npm run dev           # dev server at http://localhost:4317 (/preview on SDK >= 1.3.0)"
echo "  npm run preview-shot  # docs/preview-{light,dark}.png  — show these for UI sign-off"
echo "  npm run shot          # docs/screenshot.png            — the store image (edit scripts/store-shot.html CONFIG first)"
