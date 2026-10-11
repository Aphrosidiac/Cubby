// Objective UI defect probe for a Cubby page. Import `probe(page)` from a Playwright script, or run:
//   node tools/ui-probe.mjs --port <cdp> [--w 1380 --h 880] [--theme light|dark] <route> [<route>…]
// Reports, per page: horizontal page overflow, elements clipped by the viewport or an overflow-hidden
// ancestor, text cut off without an ellipsis, overlapping interactive elements, text below WCAG contrast,
// broken images, icon-only buttons without an accessible name, and console errors.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function probe(page) {
  return page.evaluate(() => {
    const issues = []
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const desc = (el) => {
      const t = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 40)
      const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${t ? ` "${t}"` : ''}`
    }
    const visible = (el) => {
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    if (document.documentElement.scrollWidth > vw + 1) issues.push({ kind: 'page-overflow-x', detail: `scrollWidth ${document.documentElement.scrollWidth} > ${vw}` })

    const all = [...document.querySelectorAll('body *')].filter((el) => !el.closest('[aria-hidden="true"], svg, .sweep, .marker') && visible(el))
    // clipped by viewport (horizontally) or by an overflow-hidden/auto ancestor
    for (const el of all) {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 && r.left < vw && getComputedStyle(el).position !== 'fixed') issues.push({ kind: 'clipped-viewport', el: desc(el), detail: `right ${Math.round(r.right)} > ${vw}` })
      const interactive = el.matches('button, a, input, select, textarea, [role="button"]')
      if (!interactive) continue
      let p = el.parentElement
      while (p && p !== document.body) {
        const ps = getComputedStyle(p)
        if (/(hidden|clip|auto|scroll)/.test(ps.overflowX + ps.overflowY)) {
          const pr = p.getBoundingClientRect()
          const scrolls = /(auto|scroll)/.test(ps.overflowX + ps.overflowY)
          if (!scrolls && (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1)) issues.push({ kind: 'clipped-by-parent', el: desc(el), detail: desc(p) })
          break
        }
        p = p.parentElement
      }
    }
    // text cut without ellipsis: element with overflowing text content whose overflow is hidden and no ellipsis
    for (const el of all) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
      const s = getComputedStyle(el)
      const overflowX = el.scrollWidth > el.clientWidth + 1
      const overflowY = el.scrollHeight > el.clientHeight + 2 && s.overflowY !== 'visible' && !/(auto|scroll)/.test(s.overflowY)
      if (overflowX && s.overflowX !== 'visible' && !/(auto|scroll)/.test(s.overflowX) && s.textOverflow !== 'ellipsis') issues.push({ kind: 'text-cut', el: desc(el), detail: `${el.scrollWidth}>${el.clientWidth}` })
      else if (overflowY && !s.webkitLineClamp?.match(/\d/)) issues.push({ kind: 'text-cut-vertical', el: desc(el), detail: `${el.scrollHeight}>${el.clientHeight}` })
    }
    // overlapping interactive elements (not nested)
    const inter = all.filter((el) => el.matches('button, a[href], input, select, textarea, [role="button"]'))
    for (let i = 0; i < inter.length; i++) {
      const a = inter[i].getBoundingClientRect()
      if (a.bottom < 0 || a.top > vh) continue
      for (let j = i + 1; j < inter.length; j++) {
        if (inter[i].contains(inter[j]) || inter[j].contains(inter[i])) continue
        const b = inter[j].getBoundingClientRect()
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (ox > 2 && oy > 2) issues.push({ kind: 'overlap', el: desc(inter[i]), detail: desc(inter[j]) })
      }
    }
    // contrast (text elements only)
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a } }
    const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
    const bgOf = (el) => { for (let p = el; p; p = p.parentElement) { const c = parse(getComputedStyle(p).backgroundColor); if (c && c.a > 0.9) return c } return parse(getComputedStyle(document.body).backgroundColor) }
    const seen = new Set()
    for (const el of all) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
      if (el.closest('button:disabled, [aria-disabled="true"], .disabled, input::placeholder')) continue
      const s = getComputedStyle(el)
      const fg = parse(s.color)
      const bg = bgOf(el)
      if (!fg || !bg) continue
      const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05) * (fg.a < 1 ? fg.a : 1)
      const large = parseFloat(s.fontSize) >= 18.66 || (parseFloat(s.fontSize) >= 14 && Number(s.fontWeight) >= 700)
      const min = large ? 3 : 4.5
      if (ratio < min) {
        const key = desc(el) + s.color
        if (!seen.has(key)) { seen.add(key); issues.push({ kind: 'contrast', el: desc(el), detail: `${ratio.toFixed(2)} < ${min} (${s.color} on rgb(${bg.r},${bg.g},${bg.b}))` }) }
      }
    }
    for (const img of document.querySelectorAll('img')) if (visible(img) && img.complete && img.naturalWidth === 0) issues.push({ kind: 'broken-image', el: desc(img), detail: img.src.slice(0, 80) })
    for (const b of inter.filter((el) => el.matches('button, [role="button"], a'))) {
      const name = (b.getAttribute('aria-label') || b.innerText || b.getAttribute('title') || '').trim()
      if (!name) issues.push({ kind: 'no-accessible-name', el: desc(b) })
    }
    return issues
  })
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(resolve(import.meta.dirname, '..', 'package.json'))
  const { chromium } = require('playwright-core')
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
  const flags = new Set(['--port', '--w', '--h', '--theme'])
  const routes = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !flags.has(all[i - 1] ?? ''))
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${arg('port', 9600)}`)
  const page = browser.contexts()[0].pages().find((p) => p.url().includes('#/') && !p.url().includes('switcher'))
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.setViewportSize({ width: Number(arg('w', 1380)), height: Number(arg('h', 880)) })
  const theme = arg('theme', null)
  if (theme) await page.evaluate((t) => window.cubby.invoke('settings.set', { patch: { theme: t } }), theme)
  for (const r of routes) {
    errors.length = 0
    await page.evaluate((x) => (location.hash = x), r)
    await page.waitForTimeout(1200)
    const issues = await probe(page)
    for (const e of errors) issues.push({ kind: 'console-error', detail: e.slice(0, 160) })
    console.log(`\n${r}  —  ${issues.length} issue(s)`)
    for (const i of issues.slice(0, 60)) console.log(`  ${i.kind.padEnd(20)} ${i.el ?? ''}  ${i.detail ?? ''}`)
  }
  process.exit(0)
}
