#!/usr/bin/env node
// Structural validation of this repo's skill + plugin manifests.
// No dependencies — runs anywhere Node 18+ is available.
//
// Checks only *format*: manifest shape, frontmatter limits, discovery paths,
// and that every relative link inside the skill resolves. It does not judge
// the prose.

import { readFileSync, existsSync, lstatSync, readlinkSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const errors = []
const warnings = []

const fail = (m) => errors.push(m)
const warn = (m) => warnings.push(m)

// ---------------------------------------------------------------- manifests

const readJson = (rel) => {
  const p = join(ROOT, rel)
  if (!existsSync(p)) return fail(`${rel}: missing`), null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch (e) {
    return fail(`${rel}: invalid JSON — ${e.message}`), null
  }
}

const plugin = readJson('.claude-plugin/plugin.json')
const marketplace = readJson('.claude-plugin/marketplace.json')

if (plugin) {
  for (const field of ['name', 'description']) {
    if (!plugin[field]) fail(`plugin.json: required field "${field}" missing`)
  }
  if (plugin.name && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(plugin.name)) {
    fail(`plugin.json: name "${plugin.name}" is not a lowercase slug`)
  }
  if (plugin.license === 'MIT' && !existsSync(join(ROOT, 'LICENSE'))) {
    fail('plugin.json declares "license": "MIT" but no LICENSE file exists')
  }
}

if (marketplace) {
  if (!marketplace.name) fail('marketplace.json: required field "name" missing')
  if (!marketplace.description) warn('marketplace.json: no description')
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    fail('marketplace.json: "plugins" must be a non-empty array')
  }
  for (const entry of marketplace.plugins ?? []) {
    if (!entry.name) fail('marketplace.json: a plugin entry has no "name"')
    if (!entry.source) fail(`marketplace.json: "${entry.name}" has no "source"`)
    if (plugin && entry.name && entry.name !== plugin.name) {
      fail(`marketplace.json: entry "${entry.name}" does not match plugin.json name "${plugin.name}"`)
    }
  }
}

// ------------------------------------------------------------------- skills

const SKILLS_DIR = join(ROOT, 'skills')
if (!existsSync(SKILLS_DIR)) fail('skills/: missing')

for (const name of readdirSync(SKILLS_DIR)) {
  const dir = join(SKILLS_DIR, name)
  if (!lstatSync(dir).isDirectory()) continue
  const skillPath = join(dir, 'SKILL.md')

  if (!existsSync(skillPath)) {
    fail(`skills/${name}/SKILL.md: missing`)
    continue
  }

  const text = readFileSync(skillPath, 'utf8')
  if (!text.startsWith('---\n')) {
    fail(`skills/${name}/SKILL.md: must start with a YAML frontmatter fence`)
    continue
  }
  const end = text.indexOf('\n---', 4)
  if (end === -1) {
    fail(`skills/${name}/SKILL.md: frontmatter is not closed`)
    continue
  }
  const fm = text.slice(4, end)

  const field = (key) => {
    const line = fm.split('\n').find((l) => l.startsWith(`${key}:`))
    return line ? line.slice(key.length + 1).trim() : null
  }

  // name + description are the only two fields both Claude Code and Codex
  // require; keeping the frontmatter to these keeps the skill portable.
  const skillName = field('name')
  const description = field('description')

  if (!skillName) fail(`skills/${name}/SKILL.md: frontmatter field "name" missing`)
  else {
    if (skillName !== name) {
      fail(`skills/${name}/SKILL.md: name "${skillName}" must equal the directory name "${name}"`)
    }
    if (skillName.length > 64) fail(`skills/${name}/SKILL.md: name exceeds 64 chars`)
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName)) {
      fail(`skills/${name}/SKILL.md: name "${skillName}" is not a lowercase slug`)
    }
  }

  if (!description) fail(`skills/${name}/SKILL.md: frontmatter field "description" missing`)
  else {
    if (description.length > 1024) {
      fail(`skills/${name}/SKILL.md: description is ${description.length} chars (max 1024)`)
    }
    // An unquoted scalar containing ": " silently truncates or breaks the parse.
    const bare = !/^['"]/.test(description) && !description.startsWith('>') && !description.startsWith('|')
    if (bare && description.includes(': ')) {
      fail(`skills/${name}/SKILL.md: unquoted description contains ": " — quote it`)
    }
  }

  // Every relative markdown link inside the skill must resolve.
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
  for (const file of walk(dir).filter((f) => f.endsWith('.md'))) {
    for (const [, target] of readFileSync(file, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const clean = target.split('#')[0]
      if (!clean) continue
      if (!existsSync(resolve(dirname(file), clean))) {
        fail(`${relative(ROOT, file)}: broken relative link "${target}"`)
      }
    }
  }
}

// ------------------------------------------------- codex discovery symlinks

const codexDir = join(ROOT, '.agents/skills')
if (!existsSync(codexDir)) {
  fail('.agents/skills/: missing — Codex will not discover any skill in this repo')
} else {
  for (const name of readdirSync(SKILLS_DIR)) {
    const link = join(codexDir, name)
    if (!existsSync(link)) {
      fail(`.agents/skills/${name}: missing — skills/${name} is invisible to Codex`)
      continue
    }
    // Codex silently skips a symlinked SKILL.md; the *directory* must be linked.
    if (lstatSync(link).isSymbolicLink() && readlinkSync(link).endsWith('SKILL.md')) {
      fail(`.agents/skills/${name}: links to SKILL.md — link the directory instead`)
    }
    if (!existsSync(join(link, 'SKILL.md'))) {
      fail(`.agents/skills/${name}: does not resolve to a directory containing SKILL.md`)
    }
  }
}

// ------------------------------------------------------------------- report

for (const w of warnings) console.log(`⚠ ${w}`)
for (const e of errors) console.log(`✗ ${e}`)

if (errors.length) {
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`)
  process.exit(1)
}
console.log(`✔ validation passed${warnings.length ? ` with ${warnings.length} warning(s)` : ''}`)
