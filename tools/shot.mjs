// Screenshot a running Cubby instance: node tools/shot.mjs --port <cdp> --out <dir> [--w 1380 --h 880] [--theme light|dark] <route> [<route>…]
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
const require = createRequire(resolve(import.meta.dirname, '..', 'package.json'))
const { chromium } = require('playwright-core')
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const flags = new Set(['--port', '--out', '--w', '--h', '--theme'])
const routes = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !flags.has(all[i - 1] ?? ''))
const port = arg('port', 9600)
const out = resolve(arg('out', '.'))
const w = Number(arg('w', 1380))
const h = Number(arg('h', 880))
mkdirSync(out, { recursive: true })
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages().find((p) => p.url().includes('#/') && !p.url().includes('switcher'))
await page.setViewportSize({ width: w, height: h })
const theme = arg('theme', null)
if (theme) await page.evaluate((t) => window.cubby.invoke('settings.set', { patch: { theme: t } }), theme)
for (const r of routes) {
  await page.evaluate((x) => (location.hash = x), r)
  await page.waitForTimeout(1100)
  const name = `${r.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}-${w}x${h}${theme ? '-' + theme : ''}.png`
  await page.screenshot({ path: join(out, name) })
  console.log(join(out, name))
}
process.exit(0)
