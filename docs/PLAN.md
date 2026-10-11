# Brand Browsers — Plan v2 (complete desktop app)

> Working name until one is picked. Status: **plan, nothing built**. v2 written 2026-10-11:
> v1 was a CLI + MCP with no home app; v2 is a complete AdsPower-style desktop app.
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
│ Main process (Node):                                                                │
│   Core: brands/accounts store (SQLite) · launcher · window manager · CDP connector  │
│         guardrails · pacing ledger · recipes · flows engine · scheduler · health    │
│         media indexer · backup/export · secrets (safeStorage → OS keychain)         │
│   Local API  http://127.0.0.1:7820      (token) ──┐                                 │
│   MCP        http://127.0.0.1:7820/mcp  (token) ──┴── Claude Code, scripts          │
│   Tray / menu-bar icon · global hotkey quick switcher · OS notifications            │
└──────────────┬──────────────────────────┬───────────────────────────────────────────┘
               │ CDP 127.0.0.1:9301       │ CDP 127.0.0.1:9302        (one port per brand)
               ▼                          ▼
   Google Chrome — brand "FF"     Google Chrome — brand "Ascend"     … closed brands = folders
   own user-data-dir, own logins  own user-data-dir, own logins
```

---

## 3. Stack

| Area | Pick |
|---|---|
| Shell | **Electron** (current stable), `electron-builder` → `.dmg` (Mac arm64/x64) and `.exe` (Windows NSIS) |
| UI | **Vue 3 + Vite + Pinia + vue-router**, FF Ops design tokens/components as the base (Select, Card, Field…), light + dark |
| Calendar | `@fullcalendar/vue3` (month / week / list) |
| Flow builder | `@vue-flow/core` canvas + step-list editor |
| Data | **SQLite** via `better-sqlite3` + **Drizzle ORM** (rebuilt for Electron) |
| Browser control | `playwright-core` `chromium.connectOverCDP` |
| Local API | `fastify@5` bound to 127.0.0.1 |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP on the Local API server |
| Secrets | Electron `safeStorage` (Keychain on Mac, DPAPI on Windows) |
| 2FA codes | `otplib` |
| Media | bundled `ffprobe`/`ffmpeg` static binaries |
| Export crypto | Node `crypto` (AES-256-GCM, scrypt key from your passphrase) |
| Tests | `vitest` (core), Playwright for Electron (UI e2e) |
| Language | TypeScript, pnpm |

---

## 4. Data model (SQLite)

```
Brand        id, serial (#001…), name, slug, logo, color, groupId, tags[], notes,
             profileDir, cdpPort, chromePath?, startupUrls[], window{w,h,x,y},
             downloadsDir, approvalRequired, status(closed|opening|open|error),
             lastOpenedAt, createdAt, deletedAt? (recycle bin)
Group        id, name, color, sort
Tag          id, name, color
Account      id, brandId, platform, handle, displayName, profileUrl, ageTier(new|warm|established),
             loginState(ok|expiring|expired|unknown), cookieExpiresAt, lastCheckedAt,
             secretRef? (Keychain item: username / password / TOTP secret), notes
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
ApiToken     id, name, hash, scopes[], brandIds[]?, createdAt, lastUsedAt
Activity     id, at, actor(you|claude|scheduler|flow|api), brandId?, action, detail(json), screen?
Setting      key, value
```

Files live in `~/Library/Application Support/<App>/` (Mac) or `%APPDATA%\<App>\` (Windows):
`app.sqlite`, `profiles/<slug>/` (each brand's Chrome profile), `screens/`, `thumbs/`, `exports/`.

---

## 5. How a brand opens

```
"Google Chrome" --user-data-dir=<profiles>/<slug> --remote-debugging-port=<port>
  --no-first-run --no-default-browser-check
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding
  --disable-background-timer-throttling          # no upload stalls when the window is covered
  --window-size=W,H --window-position=X,Y  <startup URLs>
```
- Separate profile folder per brand = separate cookies, storage, extensions, history. Your own Chrome
  is untouched. (Chrome 136+ only allows remote debugging on non-default profiles — which these are.)
- Per-brand settings written to the profile's `Preferences` before launch: theme colour, session
  restore on, downloads folder, Chrome password manager off (the app's account manager does that job).
  No managed Chrome policies — on a Mac they'd hit your personal Chrome too.
- The app watches each Chrome process: status updates live in the list; a crash shows "Reopen".
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
  credentials (masked, reveal with Touch ID / Windows Hello), **live 2FA code** with copy, **Fill login**
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
- Credentials only in the OS keychain via `safeStorage`; reveal/export need Touch ID / Windows Hello / OS password.
- Local API + MCP on 127.0.0.1 with tokens; CDP ports on 127.0.0.1.
- Electron hardening: `contextIsolation`, no `nodeIntegration` in the renderer, strict CSP, typed IPC allowlist.
- Activity log is append-only from the UI.

---

## 13. Repo layout
```
apps/desktop/
  src/main/       core (brands, launcher, cdp, guardrails, pacing, recipes, flows, scheduler,
                  health, media, backup, secrets), Local API + MCP, tray, IPC handlers
  src/preload/    typed bridge
  src/renderer/   Vue app (pages per §6, components/ui from FF Ops)
  resources/      icons, ffmpeg/ffprobe binaries
packages/recipes/ platform recipes + checkpoint detectors (+ saved HTML fixtures for tests)
packages/shared/  types, zod schemas, platform specs, pacing defaults
docs/
```

---

## 14. Phases (each ends with something you can use)

| Phase | Builds | Done when |
|---|---|---|
| **0 · Checks** (1 session) | Several brand Chromes driven at once; no stalls when covered (measured); `setInputFiles` on FB/IG/TikTok; import from your "Work" profile keeps FF logins; theme colour via Preferences; cookie names | `docs/PHASE0.md` with results |
| **1 · Home app** | Electron shell, Home (table/cards, groups, tags, search, filters, batch actions), New brand wizard, Brand detail (Overview, Settings), open/close/crash detection, tile/cascade, tray, quick switcher, recycle bin | You manage every brand from the app like AdsPower |
| **2 · Accounts & health** | Account manager (Keychain, Fill login, 2FA codes), login health + notifications, Cookies tab, Extensions tab, import from Chrome profile | Every brand shows its login state; relogin is two clicks |
| **3 · Claude** | Local API, MCP + all guardrails, Claude page (status, Stop, Connect Claude Code, tokens), Activity | Claude Code posts to the right brand through the app; Stop works mid-run |
| **4 · Posting** | Media library + watch folders, Composer, recipes (IG reel/carousel, FB reel, TikTok first), Approvals, Calendar/Queue, slots, scheduler | A week of scheduled FF + Ascend posts approved in the app; zero wrong-account posts, zero rate-limit flags |
| **5 · Flows** | Flow builder, recorder, schedules, more recipes (YT Shorts, Threads, X, LinkedIn, stories) | You build and schedule a custom flow without code |
| **6 · Ship** | Backups, brand export/import, Windows build, installers, auto-update, polish | Install on another machine and import your brands |

---

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
| L1 | Name | see chat |
| L2 | First brands | FF + Ascend |
| L3 | Approval default | On |
| L4 | Seed FF from your "Work" Chrome profile | Yes, if Phase 0 confirms |
| L5 | Notifications beyond OS | Telegram later, optional |
