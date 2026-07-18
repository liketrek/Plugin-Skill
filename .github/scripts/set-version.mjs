#!/usr/bin/env node
// Set the plugin version. Usage: node .github/scripts/set-version.mjs 3.4.1
//
// Only .codex-plugin/plugin.json carries a version — Codex requires one and
// caches installs per version. .claude-plugin/plugin.json deliberately has no
// version so Claude Code resolves it from the git commit and every session
// picks up the latest main. Do not "fix" that asymmetry here; see README.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const version = process.argv[2]
const ROOT = resolve(import.meta.dirname, '../..')
const TARGET = resolve(ROOT, '.codex-plugin/plugin.json')

if (!version) {
  console.error('usage: set-version.mjs <semver>')
  process.exit(1)
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`✗ "${version}" is not a valid semver version (expected e.g. 3.4.1)`)
  process.exit(1)
}

const raw = readFileSync(TARGET, 'utf8')
const manifest = JSON.parse(raw)
const previous = manifest.version

if (previous === version) {
  console.log(`version is already ${version} — nothing to do`)
  process.exit(0)
}

// Rewrite in place so field order and formatting survive.
const updated = raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`)

// Guard against a regex that matched nothing or the wrong field.
const check = JSON.parse(updated)
if (check.version !== version) {
  console.error('✗ in-place rewrite failed — aborting rather than writing a bad manifest')
  process.exit(1)
}

writeFileSync(TARGET, updated)
console.log(`${previous} → ${version}`)
