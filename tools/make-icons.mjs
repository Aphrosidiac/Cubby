// Renders every Cubby icon from SVG with headless Chrome (playwright-core) and writes:
//   build/icon.ico (16–256, Windows exe/installer/shortcuts) · build/icon.png (1024, macOS-padded, for .icns)
//   resources/icon.png (512, window + notifications) · resources/tray.png + tray@2x.png
//   resources/badges/<n>.png (taskbar overlay counts 1–9, 9+)
// Run: node tools/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const require = createRequire(join(ROOT, 'package.json'))
const { chromium } = require('playwright-core')

const INK = '#0b0b0a'
const BONE = '#f3efe4'
const LIME = '#d9ff43'

/** Full-bleed mark on a 256 grid: Ink tile, Bone 2×2 cubby grid, top-right compartment lit. */
const markLarge = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="58" fill="${INK}"/>
  <rect x="54" y="54" width="148" height="148" rx="16" fill="none" stroke="${BONE}" stroke-width="13"/>
  <path d="M128 54V202M54 128H202" stroke="${BONE}" stroke-width="13"/>
  <rect x="143" y="69" width="44" height="44" rx="6" fill="${LIME}"/>
</svg>`

/** Pixel-snapped mark for 16 / 24 / 32 px: 2 px strokes on whole pixels, compartment filled. */
const SMALL = {
  // a = frame start pixel, w = line width, n = cell size (pixels between lines), g = lime inset
  16: { a: 2, w: 1, n: 4, g: 0, r: 3 },
  24: { a: 4, w: 2, n: 5, g: 1, r: 5 },
  32: { a: 5, w: 2, n: 7, g: 1, r: 7 }
}
const markSmall = (s) => {
  const { a, w, n, g, r } = SMALL[s]
  const b = a + w + n // centre line start
  const e = b + w + n // closing line start
  const len = e + w - a
  const rect = (x, y, rw, rh, fill) => `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="${fill}"/>`
  const lines = [rect(a, a, len, w, BONE), rect(a, b, len, w, BONE), rect(a, e, len, w, BONE), rect(a, a, w, len, BONE), rect(b, a, w, len, BONE), rect(e, a, w, len, BONE)]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges">
  <rect width="${s}" height="${s}" rx="${r}" fill="${INK}" shape-rendering="geometricPrecision"/>
  ${lines.join('')}
  ${rect(b + w + g, a + w + g, n - 2 * g, n - 2 * g, LIME)}
</svg>`
}

/** macOS icon: 824 px tile centred on a 1024 canvas with the system-style soft shadow. */
const markMac = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity=".28"/></filter></defs>
  <g filter="url(#s)" transform="translate(100 100) scale(${824 / 256})">
    <rect width="256" height="256" rx="58" fill="${INK}"/>
  </g>
  <g transform="translate(100 100) scale(${824 / 256})">
    <rect x="54" y="54" width="148" height="148" rx="16" fill="none" stroke="${BONE}" stroke-width="13"/>
    <path d="M128 54V202M54 128H202" stroke="${BONE}" stroke-width="13"/>
    <rect x="143" y="69" width="44" height="44" rx="6" fill="${LIME}"/>
  </g>
</svg>`

/** Taskbar overlay badge (Windows draws it 16×16 at the icon's bottom-right). */
const badge = (label, size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="15" fill="${LIME}" stroke="${INK}" stroke-width="2"/>
  <text x="16" y="${label.length > 1 ? 21 : 22.5}" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="${label.length > 1 ? 15 : 19}" text-anchor="middle" fill="${INK}">${label}</text>
</svg>`

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ deviceScaleFactor: 1 })
async function render(svg, size) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}

mkdirSync(join(ROOT, 'build'), { recursive: true })
mkdirSync(join(ROOT, 'resources', 'badges'), { recursive: true })

// ICO: PNG-compressed entries (Vista+)
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = []
for (const s of icoSizes) pngs.push(await render(s <= 32 ? markSmall(s) : markLarge(s), s))
const header = Buffer.alloc(6 + 16 * pngs.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(pngs.length, 4)
let offset = header.length
pngs.forEach((png, i) => {
  const s = icoSizes[i]
  const e = 6 + i * 16
  header.writeUInt8(s >= 256 ? 0 : s, e)
  header.writeUInt8(s >= 256 ? 0 : s, e + 1)
  header.writeUInt8(0, e + 2)
  header.writeUInt8(0, e + 3)
  header.writeUInt16LE(1, e + 4)
  header.writeUInt16LE(32, e + 6)
  header.writeUInt32LE(png.length, e + 8)
  header.writeUInt32LE(offset, e + 12)
  offset += png.length
})
writeFileSync(join(ROOT, 'build', 'icon.ico'), Buffer.concat([header, ...pngs]))
writeFileSync(join(ROOT, 'build', 'icon.png'), await render(markMac, 1024))
writeFileSync(join(ROOT, 'resources', 'icon.png'), await render(markLarge(512), 512))
writeFileSync(join(ROOT, 'resources', 'icon.ico'), Buffer.concat([header, ...pngs]))
writeFileSync(join(ROOT, 'resources', 'tray.png'), await render(markSmall(16), 16))
writeFileSync(join(ROOT, 'resources', 'tray@2x.png'), await render(markSmall(32), 32))
// macOS menu bar: black-on-transparent template (the system tints it); lit cell filled, others open
const template = (s) => {
  const { a, w, n } = { 16: { a: 2, w: 1, n: 5 }, 32: { a: 4, w: 2, n: 10 } }[s]
  const b = a + w + n
  const e = b + w + n
  const len = e + w - a
  const r = (x, y, rw, rh) => `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="#000"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges">${[r(a, a, len, w), r(a, b, len, w), r(a, e, len, w), r(a, a, w, len), r(b, a, w, len), r(e, a, w, len), r(b + w, a + w, n, n)].join('')}</svg>`
}
writeFileSync(join(ROOT, 'resources', 'trayTemplate.png'), await render(template(16), 16))
writeFileSync(join(ROOT, 'resources', 'trayTemplate@2x.png'), await render(template(32), 32))
for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']) {
  const name = n === '9+' ? '9plus' : n
  writeFileSync(join(ROOT, 'resources', 'badges', `${name}.png`), await render(badge(n, 16), 16))
  writeFileSync(join(ROOT, 'resources', 'badges', `${name}@2x.png`), await render(badge(n, 32), 32))
}
// preview sheet for review
const sheet = `<div style="display:flex;gap:24px;align-items:flex-end;padding:24px;background:#e9e5db">${[16, 24, 32, 48, 64, 128, 256].map((s) => (s <= 32 ? markSmall(s) : markLarge(s))).join('')}<div style="background:#1f1f1d;padding:12px;display:flex;gap:16px;align-items:flex-end">${markSmall(16)}${markSmall(24)}${markSmall(32)}${markLarge(48)}</div>${badge('3', 32)}${badge('9+', 32)}</div>`
await page.setViewportSize({ width: 1100, height: 330 })
await page.setContent(`<html><body style="margin:0">${sheet}</body></html>`)
await page.screenshot({ path: join(process.env.TEMP || '/tmp', 'cubby-icon-preview.png') })
await browser.close()
console.log('icons written')
