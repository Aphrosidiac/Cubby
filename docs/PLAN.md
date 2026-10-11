# Cubby — Plan v3 (complete desktop app, one-shot build)

> Every brand gets its own cubby. v3 written 2026-10-11 on the Windows dev machine:
> v1 was a CLI + MCP with no home app; v2 made it a complete AdsPower-style desktop app;
> **v3 locks the stack (zero native modules), records the Phase 0 results, and adds the build
> contract (§18) so the whole app is built in one pass.**
> The hosted version (Dalang, `~/Desktop/dev/Dalang`) is parked on cost.

---

## 0. What this is

A **desktop app for Mac and Windows** that works like AdsPower, built around your brands:

- A **home window** listing every brand, with groups, tags, search, login status and Open/Close.
  Opening a brand launches **its own Chrome window** with its own sealed profile and logins.
- Everything around it: account manager, login health, posting composer, calendar, approvals,
  media library, automation flows (our RPA), activity log, backups/export, Local API, and
  **Claude control through MCP**.

### Mapping to AdsPower

| AdsPower | This app |
|---|---|
| Profile list (serial, name, group, tags, notes, last opened, status, Open) | **Brands** list — same, plus per-platform login health dots and logo/colour |
| Create / batch create profiles | **New brand** wizard; batch create from CSV |
| Groups, tags, search, filters | Same |
| Profile settings (startup URLs, window, cookies…) | **Brand settings** (§6.3) |
| Platform accounts (user, password, 2FA) stored on profile | **Account manager**, encrypted in Keychain / Windows Credential Manager, Fill login + live TOTP codes |
| Cookie import/export | Same, plus **encrypted brand export/import** (move brands between machines) |
| Batch open/close, arrange windows | Same (tile / cascade / bring to front) |
| Recycle bin | Same (30 days) |
| Extension center | **Extensions** tab per brand |
| Browser kernel management | Uses installed **Google Chrome**; version shown, per-brand Chrome install selectable |
| RPA (visual automation, scheduled tasks) | **Flows**: visual step builder + recorder + schedules, plus built-in posting recipes |
| Local API (open/close/list profiles, CDP endpoint for Puppeteer/Selenium) | **Local API** — same idea, Playwright/Puppeteer compatible |
| Operation logs | **Activity** log with screenshots |
| Team members, roles, profile sharing | **Not in the local app** — sharing needs a server (that's Dalang). §15 |
| Fingerprint editor, proxy per profile, IP rotation | **Deliberately excluded** — isolation, not disguise. §15 |
| Window synchronizer (mirror actions across windows) | **Deliberately excluded** — §15 |
| — | **Extra:** composer, calendar, approvals, media library, login health, Claude/MCP with guardrails, kill switch |

---

## 1. Principles
1. **Isolation, not disguise.** Each brand = its own Chrome profile on your real machine. No spoofing.
2. **Real Chrome windows.** Brands open as normal Google Chrome windows (fast, video codecs, familiar), managed by the app.
3. **One app owns everything.** Home window, scheduler, Local API and MCP all run inside the app.
4. **Guardrails in code.** Brand lock, handle check, pacing, checkpoint stop, off-limits pages, approval, audit.
5. **No machine-specific limits.** Open as many brands as your RAM allows.
6. **Secrets stay in the OS keychain.** Claude never sees passwords, 2FA codes or cookies.

---

## 2. Architecture

```
┌──────────────────────────── Desktop app (Electron) ─────────────────────────────────┐
│ Renderer (Vue 3): Home · Brand detail · Composer · Calendar · Approvals · Media ·   │
│                   Flows · Activity · Claude · Settings · Recycle bin                │
│        │ typed IPC (contextIsolation, preload bridge)                               │
│ Main process (Node 24 inside Electron):                                             │
│   CORE (one service layer — every door calls the same functions):                  │
│         store (node:sqlite) · launcher · window manager · CDP connector             │
│         guardrails · pacing ledger · recipes · flows engine · scheduler · health    │
│         media indexer · backup/export · secrets (safeStorage → OS keychain)         │
│   Doors: IPC (renderer) · Local API http://127.0.0.1:7820 · MCP …:7820/mcp          │
│          all three are thin adapters over CORE, so no door can skip a guardrail     │
│   Tray / menu-bar icon · global hotkey quick switcher · OS notifications            │
└──────────────┬──────────────────────────┬───────────────────────────────────────────┘
               │ CDP 127.0.0.1:<auto>     │ CDP 127.0.0.1:<auto>   (port read from DevToolsActivePort)
               ▼                          ▼
   Google Chrome — brand "FF"     Google Chrome — brand "Ascend"     … closed brands = folders
   own user-data-dir, own logins  own user-data-dir, own logins
```

---

## 3. Stack (locked 2026-10-11)

Rule: **fewest moving parts, each the most battle-tested option.** No native Node modules at all —
nothing to rebuild per Electron/OS, no Visual Studio build tools needed on Windows.

| Area | Pick | Why |
|---|---|---|
| Shell | **Electron 44** (Chromium 152, Node 24) | See "Why Electron" below |
| Build | **electron-vite 5** (main / preload / renderer, HMR) + `electron-builder` → NSIS `.exe`, `.dmg` | One config, fast dev loop |
| UI | **Vue 3.5 + vue-router 4**, the **FF Ops UI kit + tokens** ported (plain CSS custom properties, light + dark), small `reactive()` stores — no Pinia/Tailwind | Proven kit, zero CSS build tooling |
| Calendar | `@fullcalendar/vue3` 6 (month / week / list, drag to reschedule) | |
| Flow editor | Step-list editor (drag to reorder, per-step forms) | A canvas adds nothing for linear flows |
| Data | **`node:sqlite` (built into Node 24)**, WAL, hand-written SQL migrations + typed repositories | Verified inside Electron 44 (Phase 0). Zero native deps |
| Validation | `zod` 4 — one schema per command, shared by IPC / API / MCP | |
| Browser control | `playwright-core` 1.64 `chromium.connectOverCDP` + raw CDP sessions | Auto-waiting actions, `setInputFiles`, aria snapshots for Claude |
| Local API | `fastify` 5 on 127.0.0.1 | |
| MCP | `@modelcontextprotocol/sdk` 1.32, Streamable HTTP mounted on the same Fastify server | |
| Secrets | Electron `safeStorage` (Keychain / DPAPI); encrypted blobs in SQLite | |
| 2FA | `otplib` | |
| Schedules | `croner` (cron + next-run calc) | |
| Media | `ffmpeg-static` + `ffprobe-static` (asar-unpacked) | |
| Export crypto | Node `crypto`: AES-256-GCM, scrypt(passphrase) | |
| Tests | `vitest` (store, pacing, guardrails, checkpoint detectors, crypto, TOTP) + smoke e2e on the built app | |
| Language / pm | TypeScript, pnpm workspace | |

### Why Electron (measured 2026-10-11 on the Windows box)
- Electron 44 window with a 200-row table: **309 MB** working set, ready in 128 ms. **One** brand Chrome
  on instagram.com: **800 MB**. With 5 brands open the shell is ~7% of the total — the brand Chromes
  are the weight, and every option has to run those.
- Tauri was rejected: browser control (Playwright), the MCP SDK and the recipes are Node. Tauri would
  need a Node sidecar (two runtimes, IPC between them) for a ~60–100 MB saving; pure Rust would swap
  Playwright for far less proven CDP crates exactly where posting reliability lives.
- **Tray mode destroys the window.** Closing Cubby to the tray destroys the BrowserWindow (frees the
  renderer); the main process (scheduler, API, MCP) keeps running. Brand Chromes are detached anyway.

## 4. Data model (SQLite)

```
Brand        id, serial (#001…), name, slug, logo, color, groupId, tags[], notes, sort,
             profileDir, cdpPort (last seen), pid (last seen), chromePath?, startupUrls[], window{w,h,x,y},
             downloadsDir, approvalRequired, status(closed|opening|open|error),
             lastOpenedAt, createdAt, deletedAt? (recycle bin)
Group        id, name, color, sort
Tag          id, name, color
Account      id, brandId, platform, handle, displayName, profileUrl, ageTier(new|warm|established),
             loginState(ok|expiring|expired|unknown), cookieExpiresAt, lastCheckedAt,
             secret? (safeStorage-encrypted blob: username / password / TOTP secret), notes
MediaAsset   id, path, filename, hash, durationMs, width, height, fps, codec, sizeBytes,
             thumb, tags[], platformFit{instagram_reel: ok|warn|bad, …}, addedAt
Post         id, brandId, accountIds[], kind(reel|video|image|carousel|text|story),
             assetIds[], caption, perPlatform{caption?, cover?, firstComment?, options},
             scheduledAt, status(draft|ready_for_approval|approved|queued|running|
             needs_human|posted|failed|cancelled), approval{by, at, screens[]},
             results[{accountId, url, error, at}], createdAt
Slot         id, brandId, weekday[], time            (posting slots for "Add to queue")
Flow         id, name, brandScope(one|many|any), steps(json), schedule?(cron), enabled
FlowRun      id, flowId, brandId, status, startedAt, endedAt, log(json), screens[]
PacingRule   platform, ageTier, minGapMin, dailyMax, jitterMin
PostLedger   accountId, platform, postedAt                 (pacing source of truth)
WatchFolder  id, path, tags[]
ApiToken     id, name, hash, scopes[], brandIds[]?, createdAt, lastUsedAt
Activity     id, at, actor(you|claude|scheduler|flow|api), brandId?, action, detail(json), screen?
Setting      key, value
```

Files live in `%APPDATA%\Cubby\` (Windows) or `~/Library/Application Support/Cubby/` (Mac):
`app.sqlite`, `profiles/<slug>/` (each brand's Chrome profile), `screens/`, `thumbs/`, `exports/`.

---

## 5. How a brand opens

```
"Google Chrome" --user-data-dir=<profiles>/<slug> --remote-debugging-port=0
  --no-first-run --no-default-browser-check
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding
  --disable-background-timer-throttling          # no upload stalls when the window is covered
  --window-size=W,H --window-position=X,Y  <startup URLs>
```
- `--remote-debugging-port=0`: Chrome picks a free port and writes it to `<profile>/DevToolsActivePort`;
  the app reads it. No port allocator, no collisions with anything else on the machine.
- Chrome is spawned **detached**: quitting or updating Cubby leaves open brands running. On start the
  app **re-adopts** them (read DevToolsActivePort → probe `/json/version` → reconnect).
- Separate profile folder per brand = separate cookies, storage, extensions, history. Your own Chrome
  is untouched. (Chrome 136+ only allows remote debugging on non-default profiles — which these are.)
- Per-brand settings written to the profile's `Preferences` before launch: theme colour, session
  restore on, downloads folder, Chrome password manager off (the app's account manager does that job).
  No managed Chrome policies — on a Mac they'd hit your personal Chrome too.
- The app watches each Chrome (CDP disconnect + 5 s heartbeat): status updates live in the list; a
  crash shows "Reopen". Tile / cascade / bring-to-front use CDP `Browser.setWindowBounds` — no
  OS-specific window code.
- CDP binds to 127.0.0.1 only; Chrome rejects web-page origins on it.
- Known limit: Cmd-Tab / taskbar shows every brand as "Google Chrome"; the theme colour, a title
  badge and the app's "bring to front" / quick switcher make up for it.

---

## 6. The app, screen by screen

### 6.1 Home — Brands
- **Table view** (default) and **card view**. Columns: ☐ · serial · logo · name · group · tags ·
  platforms (one dot per account: green ok / amber expiring / red relogin) · status (open/closed) ·
  last opened · notes · **[Open] / [Close]** · ⋯ menu.
- **Sidebar:** All brands · groups (with counts) · tags · Needs relogin · Open now · Recycle bin.
- **Search** (name, handle, tag, serial, notes) + filters (group, tag, platform, login state, status).
- **Batch actions** on selected: Open · Close · Move to group · Add/remove tags · Health check ·
  Export · Delete (→ recycle bin).
- **Window tools:** Tile open brands · Cascade · Bring to front · Close all.
- Sort by any column; drag to reorder within a group.
- Top bar: **+ New brand** · Import (CSV / brand export) · approvals badge · Claude status pill.

### 6.2 New brand wizard
1. Name, logo (pick from the brand kits on disk or upload), colour, group, tags, notes.
2. Platforms + handles (Instagram, Facebook Page, TikTok, YouTube, X, LinkedIn, Threads, custom URL),
   account age tier, optional saved login (username, password, 2FA secret) → Keychain.
3. Startup URLs, window size, approval required (default on).
4. Create → profile folder made → **"Open and log in"** opens every platform's login page in that brand.

Also: **batch create from CSV**, and **import from an existing Chrome profile** (e.g. your "Work"
profile that already has FF logged in) — copies cookies/storage into the new brand on the same
machine (Phase 0 confirms).

### 6.3 Brand detail
Tabs:
- **Overview** — status, Open / Close / Bring to front, platforms with login state + "Check now",
  next scheduled posts, recent activity.
- **Accounts** — per platform: handle, profile link, age tier, login state & cookie expiry, saved
  credentials (masked; reveal with Touch ID on Mac, the app unlock passphrase on Windows — Electron
  has no Windows Hello API), **live 2FA code** with copy, **Fill login**
  (types username/password into this brand's open login page).
- **Settings** — name/logo/colour/group/tags/notes, startup URLs, window size/position, downloads
  folder, Chrome install, approval required, pacing tier overrides.
- **Cookies** — domains + expiry (values hidden), **Export cookies** (Touch ID, encrypted file),
  **Import cookies** (JSON), **Clear site data** per platform.
- **Extensions** — what's installed in this brand; "Open Web Store in this brand".
- **Posts** — this brand's queue and history (links to live posts).
- **Activity** — everything done in this brand.

### 6.4 Composer
- Pick **brand** → pick accounts (IG / FB / TikTok / …) → attach media from the library or drag from Finder/Explorer.
- One caption with **per-platform overrides** (caption, hashtags, cover frame, first comment,
  TikTok privacy/duet/stitch, IG share-to-feed, FB Page).
- Live **platform-fit checks** (aspect, length, codec, caption length, hashtag count).
- **Post now** · **Schedule** (date/time, MYT) · **Add to queue** (next free slot) · Save draft.
- **Prepare** runs the recipe up to the final button in the brand's window and attaches screenshots
  for approval.
- Same content to several brands = separate posts, each paced on its own.

### 6.5 Calendar & Queue
- Month / week / list across all brands; colour = brand. Drag to reschedule (pacing re-checked).
- Per-brand **posting slots** (e.g. Ascend daily 20:00) for "Add to queue".
- Status chips: draft · awaiting approval · queued · running · needs you · posted · failed.

### 6.6 Approvals
Inbox of prepared posts: per platform, a screenshot of the filled composer + caption, media, account.
**Approve** (all or per platform) / **Edit** / **Reject**; batch approve. Approved scheduled posts run
unattended at their time.

### 6.7 Media library
Drag-drop files or **watch folders** (e.g. FFAds `out/`): auto-indexed with thumbnails, duration,
size, aspect and platform-fit badges. Tags, search, preview player, "used in" (which posts). Files stay
where they are; the library indexes them.

### 6.8 Flows (our RPA)
- **Built-in recipes** (maintained by us): Instagram reel / carousel / story, Facebook reel / post,
  TikTok video, YouTube Short, Threads, X, LinkedIn, "Check all logins". They encode the known traps
  (IG Escape = discard, IG crop → Original, TikTok filename in description, FB cover frame).
- **Flow builder** steps: Open brand · Open URL · Click · Type · Upload file · Wait for · Screenshot ·
  If element/text exists · Loop over media · Run recipe · **Ask Claude** · Notify me · Close brand.
- **Recorder:** press Record, do it once in a brand window, steps are captured, then edit them.
- Run on one brand or a selection (one at a time per account, paced). Schedules ("every day 09:00").
  Run history with logs + screenshots. A daily dry run of each recipe flags platform UI changes early.

### 6.9 Activity
Everything by you / Claude / scheduler / flows / API: time, brand, action, result, screenshot.
Filters, export CSV.

### 6.10 Claude
- Status: MCP running, connected clients, live runs ("Claude is working in **FF** — Instagram").
- **Stop** (kill switch: aborts all agent runs).
- **Connect Claude Code**: writes the MCP entry with a scoped token.
- Tokens: create / revoke, scope to brands and tool groups.

### 6.11 Settings
General (data folder, launch at login, tray, quick-switch hotkey) · Chrome (install path, version,
port range) · Posting (approval default, pacing rules table, quiet hours, catch-up when the machine
was asleep) · Notifications (OS; Telegram optional) · Backups (schedule, folder, passphrase) ·
Local API (port, tokens) · Appearance (light / dark / system).

### 6.12 Recycle bin
Deleted brands kept 30 days with their profiles; Restore or Delete forever (confirm).

### 6.13 Tray / menu bar + quick switcher
Tray: brands with open/close, approvals count, "Claude is working…", Stop, open app.
Quick switcher (global hotkey): type "asc" → Enter → Ascend's window opens or comes to front.

---

## 7. Local API (127.0.0.1:7820, token)

| Endpoint | Does |
|---|---|
| `GET/POST /api/brands`, `PATCH/DELETE /api/brands/:id` | CRUD |
| `POST /api/brands/:id/open` → `{ cdpUrl, wsEndpoint }` | Open (or reuse); endpoint for Playwright/Puppeteer |
| `POST /api/brands/:id/close` | Close |
| `GET /api/brands/:id/health` | Login state per platform |
| `GET/POST /api/posts`, `POST /api/posts/:id/prepare · approve · run` | Posting |
| `GET/POST /api/media` | Library |
| `POST /api/flows/:id/run` | Run a flow |
| `GET /api/activity` | Log |

Raw CDP endpoints only for tokens with the `cdp` scope (your own scripts) — never the MCP token.

---

## 8. MCP (Claude Code)

Served by the app at `http://127.0.0.1:7820/mcp`.

| Group | Tools (every call names a `brand`) |
|---|---|
| Brands | `brands_list`, `brand_open`, `brand_close`, `brand_health` |
| Browser | `tabs`, `tab_open`, `tab_select`, `tab_close`, `navigate`, `snapshot`, `click`, `type`, `press`, `scroll`, `wait_for`, `screenshot`, `page_text`, `upload(path)` |
| Posting | `media_find`, `post_create`, `post_prepare`, `post_status`, `queue_list` (publishing needs your approval in the app) |
| Flows | `flows_list`, `flow_run` |
| Log | `activity_tail` |

### Guardrails (enforced by the app)
1. **Brand lock** — an MCP session binds to one brand until it explicitly switches.
2. **Handle check** — before publishing, the page's active account must match the brand's account.
3. **Pacing** per account (defaults from the 29 Sep 2026 flags): new accounts ≥ 60 min between posts
   per platform, ≤ 3/day; established ≥ 20 min, ≤ 10/day; ±10 min jitter. Editable in Settings.
4. **Checkpoint stop** — challenge/checkpoint URLs, captcha frames, "Confirm you're human" / "We limit
   how often" / "Please wait" → stop, front the window, notify. **Never solved by the app.**
5. **Off-limits pages** for Claude: account settings, password, 2FA, login activity, billing, deactivation.
6. **Approval** — publishing goes through the Approvals inbox (per-brand toggle).
7. **No secrets to Claude** — no tool returns passwords, 2FA codes or cookie values.
8. **Kill switch** in app + tray. Everything recorded in Activity.

---

## 9. Login health
Reads each platform's session cookie **presence + expiry** over CDP (no page loads): IG `sessionid`,
FB `c_user` + `xs`, TikTok `sessionid`, X `auth_token`, LinkedIn `li_at`, YouTube `__Secure-3PSID`
(confirmed in Phase 0). Open brands are checked live; closed ones once a day in the background.
ok / expiring (< 7 days) / relogin → dots on Home, "Needs relogin" filter, notification.
Relogin: Brand → Accounts → **Fill login** + 2FA code; you finish it.

---

## 10. Scheduler
Runs inside the app (launch at login, lives in the tray). Every minute: due + approved + pacing OK →
open brand if closed → recipe → verify → save post URL → notify. Brands run in parallel; one run per
brand at a time. Machine asleep/off → missed posts run on wake, re-paced (or skipped, per Settings).

---

## 11. Backup & moving machines
- **Scheduled backup:** DB + all brand profiles → encrypted archive (AES-256-GCM, your passphrase) to a
  folder you choose (external drive, iCloud Drive, Google Drive folder).
- **Export brand(s)** → `.brand` file: settings, accounts (credentials only if ticked), cookies decrypted
  on this machine and re-encrypted with your passphrase.
- **Import** on another Mac or Windows PC: recreates the brands and writes the cookies into fresh
  profiles. (Raw profile folders can't move between machines — cookies are tied to each OS keychain —
  so moving goes through export/import.) Some platforms may ask to re-verify on a new device.

---

## 12. Security
- Profiles + DB inside your user account; FileVault / BitLocker on.
- Credentials encrypted with `safeStorage` (OS keychain key); reveal/export need Touch ID (Mac) or the
  app unlock passphrase (Windows).
- Local API + MCP on 127.0.0.1 with tokens; CDP ports on 127.0.0.1.
- Electron hardening: `contextIsolation`, no `nodeIntegration` in the renderer, strict CSP, typed IPC allowlist.
- Activity log is append-only from the UI.

---

## 13. Repo layout

One package (simplest and most reliable with electron-builder; pnpm with `node-linker=hoisted`):
```
src/shared/      contract.ts (every command + events), types, platforms (specs, fit targets, pacing
                 defaults, off-limits pages), checkpoints, pacing, csv — pure TS, unit-tested
src/main/        core/ (db, migrations, registry, events, activity, settings, runtime, crypto, notify)
                 modules/<name>/ (brands, browser, accounts, health, media, pacing, runs, recipes,
                 flows, posts, tools, tokens, mcp, api, backup, scheduler, app)
                 index.ts · windows.ts · tray.ts · ipc.ts · protocol.ts (cubby-file://)
src/preload/     the bridge (invoke, onEvent, pathForFile)
src/renderer/    Vue app: pages/, components/{ui,shell,common,brands,posts,media,flows,claude,…}
docs/            PLAN.md, BUILD.md
```

## 14. Phase 0 results (2026-10-11, Windows 11, Chrome 154.0.8037.98)

| Check | Result |
|---|---|
| `node:sqlite` inside Electron 44.7.0 (Node 24.21) | ✅ works, JSON1 available → no native SQLite module |
| 3 brand Chromes at once, own `--user-data-dir` + CDP | ✅ all three CDP endpoints up in 743 ms |
| Playwright 1.64 `connectOverCDP` to all three in parallel | ✅ |
| `setInputFiles` through CDP | ✅ (synthetic page; FB/IG/TikTok confirmed when the recipes run live) |
| Timers not throttled (`--disable-background-timer-throttling` etc.) | ✅ 21–22 ticks / 2 s at a 100 ms interval |
| Cookie expiry readable without page loads | ✅ `context.cookies(url)` returns name + expires |
| Theme colour via `Preferences` before launch | written; visual confirmation in the first app run |
| Import from an existing Chrome profile | Cookies are encrypted per OS user — the import copies the profile's files into the brand folder on the same machine (same user + same Chrome = decryptable) |

## 14b. Build order (one pass)

| Step | Builds |
|---|---|
| 1 · Foundation | pnpm workspace, electron-vite app, shared types + zod schemas, SQLite migrations + repos, CORE command registry, IPC bridge, FF UI kit + shell layout |
| 2 · Modules (parallel) | launcher/CDP/windows/health/accounts/secrets · Local API + MCP + guardrails · recipes + checkpoint detectors + flows engine + recorder + scheduler · media + backup/export · every renderer page |
| 3 · Integration | wire modules into CORE, typecheck, vitest, build the Windows installer, launch the built app and drive it: create FF + Ascend, open/close, health, compose → prepare → approve, flow run, MCP via Claude Code, kill switch |

## 15. Deliberately not included
| AdsPower feature | Why not |
|---|---|
| Fingerprint editor / spoofing | Disguise invites bans for real brands; yours are legitimate and run from your real machine. |
| Proxy per profile / IP rotation | Same reason; all brands share your normal connection, which is fine for one owner. |
| Window synchronizer | Mirroring identical actions across accounts is the mass-posting pattern platforms punish; composer + pacing covers multi-brand posting properly. |
| Team members, roles, sharing | Needs a server — the Dalang plan, if ever. |

---

## 16. Risks
| Risk | Mitigation |
|---|---|
| Platform UI changes break a recipe | Fails loudly (never posts blind); Claude or you take over the window; daily dry runs catch it early. |
| Machine asleep at post time | Catch-up per Settings; optional wake schedule. |
| Automated posting vs platform terms | Human pace, approval, real accounts on your real connection. Residual risk accepted knowingly. |
| Chrome / Electron updates | Electron pinned per release; recipes re-checked against current Chrome each release. |
| Unsigned app warnings | Fine for personal use; signing only if distributed. |

---

## 17. Decisions
| # | Decision | Recommendation |
|---|---|---|
| L1 | Name | **Cubby** (decided 2026-10-11) |
| L2 | First brands | FF + Ascend |
| L3 | Approval default | On |
| L4 | Seed FF from your "Work" Chrome profile | Yes — profile-copy import on the same machine |
| L6 | Stack | Electron 44 + electron-vite + Vue 3 + node:sqlite + Playwright CDP + Fastify + MCP SDK (§3) |
| L7 | Brand Chromes outlive the app | Yes — detached, re-adopted on start |
| L5 | Notifications beyond OS | Telegram later, optional |

---

## 18. Build contract (how the code is shaped)

- **CORE commands.** Every capability is one function `(input, ctx) => output` registered by name
  (`brands.create`, `brands.open`, `posts.prepare`, …) with a zod input schema. `ctx.actor` is
  `you | claude | scheduler | flow | api`. Guardrails and Activity logging run inside CORE, keyed off
  the actor — the doors only authenticate and translate.
- **IPC:** one `invoke(command, input)` channel + one `event` push channel (`brand.status`,
  `run.progress`, `approvals.count`, `activity.new`, …). The preload exposes only these two.
- **Local API** maps REST routes to commands; **MCP** maps tools to commands with `actor: 'claude'`
  and the brand lock from the MCP session.
- **Runs** (recipes, flows, Claude browser tools) go through one run manager: one run per brand at a
  time, abortable (kill switch aborts all), every step logged + screenshot on failure.
- **Recipes are flows written in TypeScript** using the same step runtime as user flows.
- **Checkpoint detectors and platform specs are pure functions** in `packages/shared`, unit-tested.
