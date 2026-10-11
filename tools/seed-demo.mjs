// Seed an isolated Cubby instance with realistic demo data in every state, for visual audits and demos.
//   node tools/seed-demo.mjs --data <dir> --port <cdpPort> [--api <apiPort>] [--keep] [--exe <Cubby.exe>]
// Launches the app (built `out/` by default, or --exe) on <dir>, seeds through the app's own commands,
// then forces the states real use would reach (ready for approval, posted, failed runs, login states…)
// with direct SQLite writes. Brand Chromes are never opened and nothing touches the network.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = resolve(import.meta.dirname, '..')
const require = createRequire(join(ROOT, 'package.json'))
const { chromium } = require('playwright-core')
const FFMPEG = require('ffmpeg-static')

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
const DATA = resolve(arg('data', join(process.env.TEMP || '/tmp', 'cubby-demo')))
const PORT = Number(arg('port', 9600))
const API = Number(arg('api', 7860))
const KEEP = process.argv.includes('--keep')
const EXE = arg('exe', null)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (existsSync(DATA)) rmSync(DATA, { recursive: true, force: true })
mkdirSync(join(DATA, 'demo-media'), { recursive: true })
const MEDIA = join(DATA, 'demo-media')

// ── media files ───────────────────────────────────────────────────────────────
const ff = (args) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args])
const vids = [
  ['ascend-reel-site-visit.mp4', 'testsrc2=size=1080x1920:rate=30', 9],
  ['ff-launch-film-16x9.mp4', 'smptebars=size=1920x1080:rate=30', 12],
  ['kopi-lab-latte-art.mp4', 'mandelbrot=size=1080x1920:rate=30', 6],
  ['square-teaser.mp4', 'testsrc=size=1080x1080:rate=25', 5],
  ['too-short-clip.mp4', 'rgbtestsrc=size=1080x1920:rate=30', 2],
  ['will-go-missing.mp4', 'testsrc=size=720x1280:rate=30', 4]
]
for (const [name, src, t] of vids) ff(['-f', 'lavfi', '-i', src, '-t', String(t), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(MEDIA, name)])
const imgs = [
  ['carousel-01-portrait.jpg', 'testsrc2=size=1080x1350', 'Sunlight racking bay A'],
  ['carousel-02-portrait.jpg', 'smptehdbars=size=1080x1350', 'Sunlight racking bay B'],
  ['carousel-03-portrait.jpg', 'mandelbrot=size=1080x1350', 'Sunlight racking bay C'],
  ['logo-square.png', 'color=c=0x0b0b0a:size=1080x1080', ''],
  ['wide-banner-a-very-long-file-name-that-should-truncate-gracefully-in-every-grid-and-list.jpg', 'testsrc=size=1920x1005', '']
]
for (const [name, src] of imgs) ff(['-f', 'lavfi', '-i', src, '-frames:v', '1', join(MEDIA, name)])

// ── launch the app ────────────────────────────────────────────────────────────
const bin = EXE ?? require('electron')
const args = EXE ? [`--remote-debugging-port=${PORT}`] : [ROOT, `--remote-debugging-port=${PORT}`]
const app = spawn(bin, args, { env: { ...process.env, CUBBY_DATA_DIR: DATA }, stdio: 'ignore', detached: true })
app.unref()
let browser
for (let i = 0; i < 80 && !browser; i++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`) } catch { await sleep(400) }
}
if (!browser) throw new Error('app did not start')
let page
for (let i = 0; i < 60 && !page; i++) {
  page = browser.contexts()[0].pages().find((p) => p.url().includes('#/') && !p.url().includes('switcher'))
  if (!page) await sleep(250)
}
await page.waitForSelector('.shell', { timeout: 20000 })
const inv = async (name, input = {}) => {
  const r = await page.evaluate(([n, i]) => window.cubby.invoke(n, i), [name, input])
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`)
  return r.data
}

await inv('settings.set', { patch: { apiPort: API, notifications: { os: false } } })
await inv('settings.setUnlockPassphrase', { passphrase: 'demo-unlock' })
await inv('settings.setBackupPassphrase', { passphrase: 'demo-backup-pass' })

// ── groups, brands, accounts ─────────────────────────────────────────────────
const studio = await inv('groups.create', { name: 'Studio', color: '#0b0b0a' })
const clients = await inv('groups.create', { name: 'Clients', color: '#2c4f9c' })
const personal = await inv('groups.create', { name: 'Personal', color: '#1d6b45' })
const logo = (txt, bg, fg = '#f3efe4') =>
  'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${bg}"/><text x="32" y="41" font-family="Arial" font-weight="700" font-size="24" text-anchor="middle" fill="${fg}">${txt}</text></svg>`).toString('base64')

const B = {}
const mk = async (key, input) => (B[key] = await inv('brands.create', input))
await mk('ff', { name: 'FF Dev Studio', color: '#0b0b0a', logo: logo('FF', '#0b0b0a', '#d9ff43'), groupId: studio.id, tags: ['studio', 'flagship'], notes: 'Main studio brand. Hai Awan is the flagship project.', approvalRequired: false,
  accounts: [{ platform: 'instagram', handle: '@ffdev.studio', ageTier: 'warm', username: 'ffdev.studio', password: 'demo-pass-1', totpSecret: 'JBSWY3DPEHPK3PXP' }, { platform: 'x', handle: '@ffdevstudio', ageTier: 'new' }, { platform: 'tiktok', handle: '@ffdev', ageTier: 'new' }, { platform: 'linkedin', handle: 'company/ff-dev-studio', ageTier: 'established' }, { platform: 'threads', handle: '@ffdev.studio' }] })
await mk('ascend', { name: 'Ascend Resources', color: '#1d6b45', groupId: clients.id, tags: ['client', 'mining'], notes: 'Approval on — client signs off every post.', approvalRequired: true,
  accounts: [{ platform: 'facebook', handle: 'ascendresources', ageTier: 'established' }, { platform: 'instagram', handle: '@ascend.my', ageTier: 'warm' }, { platform: 'youtube', handle: '@ascendresources', ageTier: 'new' }] })
await mk('kopi', { name: 'Kopi Lab', color: '#8a5a00', groupId: personal.id, tags: ['food'], accounts: [{ platform: 'instagram', handle: '@kopilab.kl' }, { platform: 'tiktok', handle: '@kopilab' }] })
await mk('shuda', { name: 'Shuda Logistics', color: '#2c4f9c', groupId: clients.id, tags: ['client', 'logistics'], accounts: [{ platform: 'facebook', handle: 'shudalogistics', ageTier: 'established' }, { platform: 'linkedin', handle: 'company/shuda', ageTier: 'established' }] })
await mk('sunlight', { name: 'Sunlight Supplies Industrial Racking & Storage Solutions Sdn Bhd', color: '#be185d', groupId: clients.id, tags: ['client', 'industrial', 'very-long-tag-name-for-overflow-checks'], notes: 'A deliberately long brand name and notes field to check how every table, card, header and drawer copes with overflow — it should truncate with an ellipsis and never push buttons off screen or wrap into three lines.', accounts: [{ platform: 'facebook', handle: 'sunlightsuppliesindustrialrackingmalaysia' }, { platform: 'instagram', handle: '@sunlight.supplies.racking.official' }, { platform: 'youtube', handle: '@sunlightsupplies' }, { platform: 'linkedin', handle: 'company/sunlight-supplies' }, { platform: 'tiktok', handle: '@sunlightracking' }, { platform: 'x', handle: '@sunlightrack' }, { platform: 'threads', handle: '@sunlight.supplies' }] })
await mk('indahnya', { name: 'Indahnya', color: '#6b3fa0', tags: ['saas'], accounts: [{ platform: 'instagram', handle: '@indahnya.my' }] })
await mk('lewix', { name: 'Lewix AI', color: '#0f766e', groupId: studio.id, tags: [] })
await mk('girpack', { name: 'GirPack', color: '#b45309', groupId: clients.id, tags: ['client'], accounts: [{ platform: 'facebook', handle: 'girpack' }] })
await mk('old', { name: 'Old Test Brand', color: '#475569', tags: ['test'], accounts: [{ platform: 'x', handle: '@oldtest' }] })
await inv('brands.delete', { ids: [B.old.id] })

const accs = {}
for (const [k, b] of Object.entries(B)) accs[k] = await inv('accounts.list', { brandId: b.id })
const acc = (k, p) => accs[k].find((a) => a.platform === p)

// ── media ─────────────────────────────────────────────────────────────────────
const media = await inv('media.add', { paths: [MEDIA], tags: ['demo'] })
const m = (frag) => media.find((x) => x.filename.includes(frag))
await inv('media.update', { id: m('ascend-reel').id, tags: ['demo', 'ascend', 'site visit'] })
await inv('media.update', { id: m('kopi-lab').id, tags: ['demo', 'kopi', 'latte'] })
await inv('media.addFolder', { path: MEDIA, tags: ['watched'] })

// ── slots ─────────────────────────────────────────────────────────────────────
await inv('slots.set', { brandId: B.ascend.id, slots: [{ weekdays: [1, 3, 5], time: '20:00' }, { weekdays: [6], time: '10:30' }] })
await inv('slots.set', { brandId: B.ff.id, slots: [{ weekdays: [0, 1, 2, 3, 4, 5, 6], time: '21:00' }] })

// ── posts (created as drafts through the app, states forced below) ───────────
const day = (n, h = 20, min = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, min, 0, 0); return d.toISOString() }
const mkPost = (b, accounts, kind, assetIds, caption, extra = {}) => inv('posts.create', { brandId: B[b].id, accountIds: accounts.map((a) => a.id), kind, assetIds, caption, perPlatform: extra.perPlatform ?? {}, mode: 'draft' })
const P = {}
P.ready = await mkPost('ascend', [acc('ascend', 'instagram'), acc('ascend', 'facebook')], 'reel', [m('ascend-reel').id], 'Site visit at our Kuantan operation 🌏 Safety first, every single day.\n\n#mining #malaysia #ascendresources', { perPlatform: { facebook: { caption: 'Site visit at Kuantan — safety first, every day.' } } })
P.ready2 = await mkPost('ascend', [acc('ascend', 'youtube')], 'reel', [m('ascend-reel').id], 'Kuantan site visit — full walk-through. #shorts')
P.approved = await mkPost('ascend', [acc('ascend', 'instagram')], 'carousel', [m('carousel-01').id, m('carousel-02').id, m('carousel-03').id], 'Three bays, one system. Swipe →')
P.queued = await mkPost('ff', [acc('ff', 'x'), acc('ff', 'threads')], 'text', [], 'We build websites that are impossible to ignore. New case study drops Friday.')
P.queued2 = await mkPost('ff', [acc('ff', 'instagram')], 'reel', [m('ff-launch').id], 'The FF launch film. Sound on. 🔊')
P.posted = await mkPost('ff', [acc('ff', 'linkedin'), acc('ff', 'x')], 'image', [m('logo-square').id], 'FF Dev Studio is now booking projects for Q1 2027.')
P.failed = await mkPost('kopi', [acc('kopi', 'tiktok')], 'video', [m('kopi-lab').id], 'Latte art Friday ☕ #kopilab #kl')
P.needs = await mkPost('kopi', [acc('kopi', 'instagram')], 'reel', [m('kopi-lab').id], 'New single origin just landed.')
P.running = await mkPost('shuda', [acc('shuda', 'facebook')], 'image', [m('wide-banner').id], 'Same-day delivery across the Klang Valley.')
P.cancelled = await mkPost('girpack', [acc('girpack', 'facebook')], 'text', [], 'Cancelled announcement.')
P.draft1 = await mkPost('sunlight', [acc('sunlight', 'facebook'), acc('sunlight', 'instagram'), acc('sunlight', 'linkedin')], 'carousel', [m('carousel-01').id, m('carousel-02').id], 'Draft: a long caption that keeps going to check wrapping in cards, drawers and the calendar. '.repeat(4))
P.draft2 = await mkPost('indahnya', [acc('indahnya', 'instagram')], 'image', [], 'Draft without media yet')

// ── force states real use would reach ─────────────────────────────────────────
await sleep(500)
const db = new DatabaseSync(join(DATA, 'app.sqlite'))
db.exec('PRAGMA busy_timeout = 5000')
// the daily background login check would open every brand and overwrite the seeded login states
db.prepare("INSERT INTO settings (key, value) VALUES ('health.lastDaily', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })))
const screens = join(DATA, 'screens')
const shotPng = (name, src) => { const p = join(screens, name); ff(['-f', 'lavfi', '-i', src, '-frames:v', '1', p]); return p }
const scr = {
  igPrep: shotPng('demo-ig-prepared.png', 'testsrc2=size=1280x800'),
  fbPrep: shotPng('demo-fb-prepared.png', 'smptehdbars=size=1280x800'),
  ytPrep: shotPng('demo-yt-prepared.png', 'mandelbrot=size=1280x800'),
  carPrep: shotPng('demo-carousel-prepared.png', 'testsrc=size=1280x800'),
  fail: shotPng('demo-failure.png', 'rgbtestsrc=size=1280x800'),
  checkpoint: shotPng('demo-checkpoint.png', 'color=c=0xffe9e6:size=1280x800')
}
const now = new Date().toISOString()
const setPost = (id, fields) => {
  const keys = Object.keys(fields)
  db.prepare(`UPDATE posts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => (typeof fields[k] === 'object' && fields[k] !== null ? JSON.stringify(fields[k]) : fields[k])), now, id)
}
setPost(P.ready.id, { status: 'ready_for_approval', scheduled_at: day(1, 20), screens: [{ accountId: acc('ascend', 'instagram').id, path: scr.igPrep, at: now }, { accountId: acc('ascend', 'facebook').id, path: scr.fbPrep, at: now }] })
setPost(P.ready2.id, { status: 'ready_for_approval', scheduled_at: null, screens: [{ accountId: acc('ascend', 'youtube').id, path: scr.ytPrep, at: now }] })
setPost(P.approved.id, { status: 'approved', scheduled_at: day(3, 20), approval: { by: 'you', at: now, accountIds: [acc('ascend', 'instagram').id] }, screens: [{ accountId: acc('ascend', 'instagram').id, path: scr.carPrep, at: now }] })
setPost(P.queued.id, { status: 'queued', scheduled_at: day(2, 21) })
setPost(P.queued2.id, { status: 'queued', scheduled_at: day(5, 21) })
setPost(P.posted.id, { status: 'posted', scheduled_at: day(-2, 21), results: [{ accountId: acc('ff', 'linkedin').id, url: 'https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000000/', error: null, at: day(-2, 21, 1) }, { accountId: acc('ff', 'x').id, url: 'https://x.com/ffdevstudio/status/1840000000000000000', error: null, at: day(-2, 21, 2) }] })
setPost(P.failed.id, { status: 'failed', scheduled_at: day(-1, 18), error: 'TikTok Studio did not show the Post button within 60 s (the uploader layout may have changed).', results: [{ accountId: acc('kopi', 'tiktok').id, url: null, error: 'Post button not found', at: day(-1, 18, 2) }] })
setPost(P.needs.id, { status: 'needs_human', scheduled_at: day(-1, 12), error: 'Instagram @kopilab.kl: Instagram is asking to confirm it is you — finish it in the brand window.' })
setPost(P.running.id, { status: 'running', scheduled_at: day(0, new Date().getHours(), 0) })
setPost(P.cancelled.id, { status: 'cancelled', scheduled_at: day(4, 9) })
setPost(P.draft1.id, { scheduled_at: day(6, 9, 30) })
for (const [a, at] of [[acc('ff', 'x'), day(-2, 21, 2)], [acc('ff', 'linkedin'), day(-2, 21, 1)], [acc('ff', 'instagram'), day(0, 9)]]) db.prepare('INSERT INTO post_ledger (account_id, platform, post_id, posted_at) VALUES (?, ?, ?, ?)').run(a.id, a.platform, P.posted.id, at)

// login states: ok / expiring / expired / unknown spread across brands
const login = (a, state, days) => db.prepare('UPDATE accounts SET login_state = ?, cookie_expires_at = ?, last_checked_at = ? WHERE id = ?').run(state, days == null ? null : new Date(Date.now() + days * 864e5).toISOString(), now, a.id)
login(acc('ff', 'instagram'), 'ok', 210); login(acc('ff', 'x'), 'ok', 320); login(acc('ff', 'tiktok'), 'expiring', 4); login(acc('ff', 'linkedin'), 'ok', 300); login(acc('ff', 'threads'), 'expired', -3)
login(acc('ascend', 'facebook'), 'ok', 80); login(acc('ascend', 'instagram'), 'ok', 150); login(acc('ascend', 'youtube'), 'expiring', 2)
login(acc('kopi', 'instagram'), 'expired', -10); login(acc('kopi', 'tiktok'), 'ok', 40)
login(acc('shuda', 'facebook'), 'ok', 60); login(acc('shuda', 'linkedin'), 'ok', 200)
for (const a of accs.sunlight.slice(0, 4)) login(a, 'ok', 100)
login(acc('girpack', 'facebook'), 'expired', -1)
db.prepare("UPDATE brands SET last_opened_at = ? WHERE id IN (?, ?, ?)").run(day(-1, 15), B.ff.id, B.ascend.id, B.kopi.id)
db.prepare("UPDATE brands SET status = 'error', status_error = 'Chrome closed right after starting — another Chrome may be using this profile.' WHERE id = ?").run(B.girpack.id)

// flows + runs in every state
const flowA = await inv('flows.create', { name: 'Morning login check', brandScope: 'many', brandIds: [B.ff.id, B.ascend.id, B.kopi.id], steps: [{ id: 'a1', type: 'run_recipe', recipe: 'check_logins', params: {} }, { id: 'a2', type: 'notify', message: 'Logins checked for {{brand.name}}' }], schedule: '0 9 * * *', enabled: true })
const flowB = await inv('flows.create', { name: 'Kopi Lab — weekly latte post', brandScope: 'one', brandIds: [B.kopi.id], steps: [
  { id: 'b1', type: 'open_brand' },
  { id: 'b2', type: 'open_url', url: 'https://www.instagram.com/' },
  { id: 'b3', type: 'if_exists', text: 'Log in', then: [{ id: 'b3a', type: 'notify', message: 'Kopi Lab is logged out' }, { id: 'b3b', type: 'close_brand' }], else: [{ id: 'b3c', type: 'screenshot', label: 'feed' }] },
  { id: 'b4', type: 'loop_media', tag: 'latte', steps: [{ id: 'b4a', type: 'ask_claude', prompt: 'Write a one-line caption for {{media.filename}}' }] },
  { id: 'b5', type: 'wait', ms: 2000 }
], schedule: '30 10 * * 5', enabled: false })
const flowC = await inv('flows.create', { name: 'Untitled flow with a very long name that should truncate in the flows table and the run page header', brandScope: 'any', brandIds: [], steps: [], schedule: null, enabled: true })
const runRow = (flow, recipe, brand, actor, label, status, minsAgo, durS, log, screensList, error) => {
  const id = 'run_demo_' + Math.random().toString(36).slice(2, 10)
  const start = new Date(Date.now() - minsAgo * 60_000)
  db.prepare('INSERT INTO runs (id, flow_id, recipe, brand_id, post_id, actor, label, status, started_at, ended_at, log, screens, error) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, flow, recipe, brand, actor, label, status, start.toISOString(), status === 'running' ? null : new Date(start.getTime() + durS * 1000).toISOString(),
    JSON.stringify(log.map((l, i) => ({ at: new Date(start.getTime() + i * 1500).toISOString(), level: l[0], msg: l[1], step: l[2], screen: l[3] }))), JSON.stringify(screensList), error)
}
runRow(flowA.id, null, B.ff.id, 'flow', 'Morning login check', 'ok', 140, 6, [['info', 'Start: Check session cookies', 'a1'], ['info', 'Instagram @ffdev.studio: ok (session until 2027-05-09)'], ['warn', 'TikTok @ffdev: expiring (session until 2026-10-15)'], ['info', 'Done in 0.4 s', 'a1']], [], null)
runRow(flowA.id, null, B.kopi.id, 'flow', 'Morning login check', 'needs_human', 139, 9, [['info', 'Start: Check session cookies', 'a1'], ['error', 'Instagram is asking to confirm it is you', 'a1', scr.checkpoint]], [scr.checkpoint], 'Instagram is asking to confirm it is you — finish it in the brand window.')
runRow(null, 'tiktok_video', B.kopi.id, 'scheduler', 'Post TikTok video', 'failed', 60 * 20, 64, [['info', 'Open TikTok Studio upload'], ['info', 'Upload kopi-lab-latte-art.mp4'], ['info', 'Replace description'], ['error', 'Post button not found within 60 s', null, scr.fail]], [scr.fail], 'Post button not found within 60 s')
runRow(flowB.id, null, B.kopi.id, 'you', 'Kopi Lab — weekly latte post', 'aborted', 60 * 30, 3, [['info', 'Open brand'], ['warn', 'Stopped by you']], [], 'Stopped by you')
runRow(null, 'instagram_reel', B.ascend.id, 'you', 'Prepare Instagram reel', 'ok', 30, 22, [['info', 'Handle check: @ascend.my ✓'], ['info', 'Upload ascend-reel-site-visit.mp4'], ['info', 'Crop → Original'], ['info', 'Caption filled'], ['info', 'Stopped before Share — screenshot saved', null, scr.igPrep]], [scr.igPrep], null)
runRow(null, 'facebook_post', B.shuda.id, 'scheduler', 'Post Facebook image', 'running', 1, 0, [['info', 'Open composer'], ['info', 'Upload wide banner']], [], null)

// activity from other actors
const act = (minsAgo, actor, brand, action, detail) => db.prepare('INSERT INTO activity (at, actor, brand_id, action, detail, screen) VALUES (?, ?, ?, ?, ?, ?)').run(new Date(Date.now() - minsAgo * 60_000).toISOString(), actor, brand, action, JSON.stringify(detail), null)
act(300, 'claude', B.ff.id, 'browser.navigate', { input: { brandId: B.ff.id, url: 'https://www.instagram.com/ffdev.studio/' }, via: 'Claude Code' })
act(299, 'claude', B.ff.id, 'browser.snapshot', { input: { brandId: B.ff.id }, via: 'Claude Code' })
act(298, 'claude', B.ff.id, 'browser.navigate.failed', { input: { brandId: B.ff.id, url: 'https://www.instagram.com/accounts/password/change/' }, error: 'off-limits page', rule: 'off_limits', via: 'Claude Code' })
act(240, 'scheduler', B.ff.id, 'posts.run', { input: { id: P.posted.id } })
act(239, 'scheduler', B.kopi.id, 'guardrail.checkpoint', { reason: 'Instagram is asking to confirm it is you' })
act(120, 'api', B.shuda.id, 'brands.open', { input: { id: B.shuda.id }, via: 'n8n' })
act(5, 'claude', B.ascend.id, 'posts.create', { input: { brandId: B.ascend.id, kind: 'reel' }, via: 'Claude Code' })
db.close()

// tokens (one revoked)
await inv('tokens.create', { name: 'Claude Code', scopes: ['mcp', 'read', 'brands', 'browser', 'posting', 'flows'] })
const t2 = await inv('tokens.create', { name: 'n8n automations', scopes: ['read', 'brands', 'posting'], brandIds: [B.shuda.id, B.girpack.id] })
await inv('tokens.create', { name: 'Old script', scopes: ['read'] }).then((t) => inv('tokens.revoke', { id: t.record.id }))
void t2

// a media file that disappears (missing state)
unlinkSync(join(MEDIA, 'will-go-missing.mp4'))
await inv('media.rescan')

await page.evaluate(() => location.reload())
writeFileSync(join(DATA, 'demo-ids.json'), JSON.stringify({ brands: Object.fromEntries(Object.entries(B).map(([k, v]) => [k, v.id])), posts: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.id])), flows: { a: flowA.id, b: flowB.id, c: flowC.id } }, null, 2))
console.log(`seeded ${DATA} — CDP ${PORT}, API ${API}${KEEP ? ' (app left running)' : ''}`)
if (!KEEP) {
  await inv('brands.closeAll').catch(() => {})
  process.kill(app.pid)
}
process.exit(0)
