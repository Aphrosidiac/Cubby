// Full visual sweep of a seeded Cubby instance: every route and tab × sizes × themes, screenshot + probe.
//   node tools/audit-all.mjs --port <cdp> --data <seed dir> --out <dir> [--sizes 980x620,1380x880,1920x1080] [--themes light,dark]
// Writes <out>/<theme>/<size>/<route>.png and <out>/report.json; prints issues that are not known probe
// false positives (Segmented highlight, labelled switches, floating menus, sr-only text).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { probe } from './ui-probe.mjs'

const require = createRequire(resolve(import.meta.dirname, '..', 'package.json'))
const { chromium } = require('playwright-core')
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const out = resolve(arg('out', 'audit-out'))
const ids = JSON.parse(readFileSync(join(resolve(arg('data')), 'demo-ids.json'), 'utf8'))
const sizes = arg('sizes', '980x620,1380x880,1920x1080').split(',').map((s) => s.split('x').map(Number))
const themes = arg('themes', 'light,dark').split(',')

const routes = [
  '/', '/brands/new', '/recycle', '/compose', `/compose?post=${ids.posts.draft1}`, `/compose?post=${ids.posts.posted}`, `/compose?post=${ids.posts.failed}`,
  '/calendar', '/approvals', '/media', '/flows', '/flows?tab=recipes', '/flows?tab=runs', `/flows/${ids.flows.b}`, '/flows/new',
  '/activity', '/claude',
  ...['general', 'chrome', 'posting', 'notifications', 'security', 'backups', 'api', 'appearance', 'about'].map((t) => `/settings?tab=${t}`),
  ...['overview', 'accounts', 'settings', 'cookies', 'extensions', 'posts', 'activity'].map((t) => `/brands/${ids.brands.sunlight}?tab=${t}`),
  `/brands/${ids.brands.ff}`, `/brands/${ids.brands.girpack}`, `/brands/${ids.brands.lewix}`, `/brands/${ids.brands.old}`
]

const FALSE = [
  (i) => i.kind === 'contrast' && /seg|segment/i.test(i.el ?? ''),
  (i) => i.kind === 'no-accessible-name' && /track|toggle/i.test(i.el ?? ''),
  (i) => i.kind === 'overlap' && /menu|\.mi/.test((i.el ?? '') + (i.detail ?? '')),
  (i) => i.kind.startsWith('text-cut') && /sr-only/.test(i.el ?? '')
]

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${arg('port', 9700)}`)
const page = browser.contexts()[0].pages().find((p) => p.url().includes('#/') && !p.url().includes('switcher'))
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
const report = []
for (const theme of themes) {
  await page.evaluate((t) => window.cubby.invoke('settings.set', { patch: { theme: t } }), theme)
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h })
    const dir = join(out, theme, `${w}x${h}`)
    mkdirSync(dir, { recursive: true })
    for (const r of routes) {
      errors.length = 0
      await page.evaluate(() => (location.hash = '#/activity'))
      await page.waitForTimeout(150)
      await page.evaluate((x) => (location.hash = x), r)
      await page.waitForTimeout(1300)
      const name = r.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/_+$/, '') || 'home'
      await page.screenshot({ path: join(dir, `${name}.png`) })
      const issues = (await probe(page)).concat(errors.map((e) => ({ kind: 'console-error', detail: e.slice(0, 200) })))
      const real = issues.filter((i) => !FALSE.some((f) => f(i)))
      report.push({ theme, size: `${w}x${h}`, route: r, shot: join(dir, `${name}.png`), issues: real })
      if (real.length) {
        console.log(`${theme} ${w}x${h} ${r} — ${real.length}`)
        for (const i of real.slice(0, 8)) console.log(`   ${i.kind.padEnd(20)} ${i.el ?? ''}  ${i.detail ?? ''}`)
      }
    }
  }
}
await page.evaluate(() => window.cubby.invoke('settings.set', { patch: { theme: 'light' } }))
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
const total = report.reduce((n, r) => n + r.issues.length, 0)
console.log(`\n${report.length} pages swept, ${total} issue(s) outside known probe false positives → ${join(out, 'report.json')}`)
process.exit(0)
