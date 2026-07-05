#!/usr/bin/env node
/*
 * shot.mjs — screenshot a TREK plugin's UI (for docs/screenshot.png and draft sign-off).
 *
 * Needs Playwright + a Chromium (Claude Code environments ship one; else `npm i -D playwright`).
 * Run it in your plugin repo. It starts `trek-plugin-sdk dev`, screenshots, and stops it.
 *
 *   node scripts/shot.mjs                 # store composite (light+dark cards + title + pills)
 *                                         #   -> docs/screenshot.png   (the publishable store image)
 *   node scripts/shot.mjs --preview       # the real widget via dev /preview, light AND dark
 *                                         #   -> docs/preview-light.png, docs/preview-dark.png
 *                                         #   (SDK >= 1.3.0; use these to get UI sign-off)
 *   node scripts/shot.mjs --url <URL> --out <file> --no-serve   # screenshot any URL as-is
 *
 * Flags: --dir <plugin dir=.>  --port <4317>  --out <docs/screenshot.png>  --no-serve  --url <url>
 *
 * The store composite is rendered from `store-shot.html` (kept next to this file) — edit its
 * CONFIG block (accent/background/pattern/kicker/pills/frames) to match the plugin first.
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'

let pw
try { pw = (await import('playwright')).default } catch {
  console.error('Missing "playwright". Install it with `npm i -D playwright`.\n' +
                '(Claude Code environments already have Chromium — just add the npm package.)')
  process.exit(1)
}
const { chromium } = pw

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d }

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(val('--dir', '.'))
const port = Number(val('--port', '4317'))
const base = `http://localhost:${port}`
const preview = has('--preview')
const serve = !has('--no-serve')
const url = val('--url', null)
const outArg = val('--out', 'docs/screenshot.png')
const docs = path.join(dir, 'docs')

const portUp = (p) => new Promise((res) => {
  const s = net.connect(p, '127.0.0.1')
  s.on('connect', () => { s.destroy(); res(true) })
  s.on('error', () => res(false))
})
async function waitPort(p, ms = 25000) {
  const t = Date.now()
  while (Date.now() - t < ms) { if (await portUp(p)) return true; await sleep(300) }
  return false
}

let dev = null
async function startDev() {
  if (await portUp(port)) return               // already running
  dev = spawn('npx', ['trek-plugin-sdk', 'dev', dir, '--port', String(port)], { stdio: 'ignore' })
  if (!await waitPort(port)) throw new Error(`dev server didn't come up on :${port} — run \`npx trek-plugin-sdk dev\` yourself and retry with --no-serve`)
}
const stopDev = () => { if (dev) try { dev.kill() } catch { /* ignore */ } }

async function capture(page, target, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  try { await page.goto(target, { waitUntil: 'networkidle', timeout: 15000 }) }
  catch { await page.goto(target, { timeout: 15000 }) }
  await sleep(600)
  await page.screenshot({ path: out })
  console.log('wrote', path.relative(process.cwd(), out))
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })

  if (url) {
    await capture(page, url, path.resolve(dir, outArg))
  } else if (preview) {
    // The real widget, themed by dev's /preview (SDK >= 1.3.0). Toggle its #theme select.
    if (serve) await startDev()
    for (const theme of ['light', 'dark']) {
      try { await page.goto(`${base}/preview`, { waitUntil: 'networkidle', timeout: 15000 }) } catch { /* retry below */ }
      await page.selectOption('#theme', theme).catch(() => { /* older dev has no toggle */ })
      await sleep(700)
      const out = path.join(docs, `preview-${theme}.png`)
      fs.mkdirSync(docs, { recursive: true })
      await page.screenshot({ path: out })
      console.log('wrote', path.relative(process.cwd(), out))
    }
  } else {
    // Store composite: temporarily place store-shot.html in client/ (dev serves it at /ui/…),
    // screenshot it, then DELETE it so it never ships in plugin.zip (pack zips all of client/).
    if (serve) await startDev()
    const src = path.join(here, 'store-shot.html')
    const dst = path.join(dir, 'client', 'harness.html')
    if (!fs.existsSync(src)) throw new Error(`store-shot.html not found next to shot.mjs (${src})`)
    fs.mkdirSync(path.join(dir, 'client'), { recursive: true })
    fs.copyFileSync(src, dst)
    try { await capture(page, `${base}/ui/harness.html`, path.resolve(dir, outArg)) }
    finally { fs.rmSync(dst, { force: true }) }
  }
} finally {
  await browser.close()
  stopDev()
}
