# Brand Browsers — Plan (local version)

> Working name until one is picked. Status: **plan, nothing built**. Written 2026-10-11.
> The hosted version (Dalang, `~/Desktop/dev/Dalang`) is parked on cost; this is the free, local one.

---

## 0. What this is

On the Mac: **one sealed Chrome per brand**, each with its own profile folder holding that brand's
full set of social logins. Open a brand with one click (or `bb open ascend`), and Claude drives
any brand through **one local MCP server** whose tools are locked to a brand and carry the
guardrails we learned from posting FF. No server, no subscription, nothing new to buy.

### Goals
1. One brand = one Chrome instance with its own profile; logins never mix.
2. Log in once per platform; stay logged in until the platform expires it; get told when it does.
3. Claude controls brands like it does through claude-in-chrome today — minus the extension drop-offs,
   the hidden-window stall, the file-picker hack and the "wrong Chrome" mix-ups.
4. Videos go straight from disk (FFAds renders) into the composer.
5. Scheduled posting with pacing and approval, while the Mac is awake.
6. **Fits in 8 GB RAM** alongside your normal work.

### Non-goals
- No fingerprint spoofing, no proxies. Isolation, not disguise.
- No captcha/"confirm you're human" solving — always handed to you.
- No cross-machine sync (profiles stay on this Mac; that's the trade for free). See §13.

---

## 1. The constraint that shapes everything: 8 GB

This Mac (A18 Pro, 8 GB) already runs Claude, dev servers and your normal Chrome. A brand Chrome
with IG + FB + TikTok open is ≈ 1.5–2.5 GB. So:

- **One brand awake at a time by default** (two max, configurable). Opening a third closes the
  least-recently-used one (profile is on disk, nothing is lost).
- **Tabs on demand**, not pinned: a brand opens to a light start page; a platform tab opens when
  needed and is closed when the task ends.
- **Auto-close** a brand 10 min after the last action (configurable, off while you're using it).
- Memory-lean flags (§3.2). The posting queue runs brands **one after another**, never in parallel.
- Phase 0 measures the real numbers; the defaults above are tuned from them.

---

## 2. Architecture

```
   You                          Claude Code (this Mac)                 launchd (every minute)
   │ Spotlight/Dock: "Ascend"   │ stdio MCP                             │ bb queue tick
   ▼                            ▼                                       ▼
 ┌──────────────────────────── bb (one Node package) ───────────────────────────────────┐
 │ CLI · MCP server · queue runner · health checker — share one core:                   │
 │   registry (brands.yaml) · launcher · CDP connector (playwright-core)                │
 │   guardrails: brand lock · handle check · pacing · checkpoint stop · off-limits URLs │
 │   recipes (IG/FB/TikTok/…) · audit log + screenshots (SQLite)                         │
 └──────────┬───────────────────────────┬───────────────────────────────────────────────┘
            │ 127.0.0.1:9301            │ 127.0.0.1:9302              (one port per brand)
            ▼                           ▼
   Chrome · profile "ff"         Chrome · profile "ascend"      … sleeping brands = folders on disk
   (lime theme, own cookies)     (own colour, own cookies)
            │                           │
            └──── files attached straight from ~/Desktop/dev/FFAds/… or ~/bb-media (same disk)
```

Everything is local to the Mac. The only network traffic is Chrome talking to the platforms.

---

## 3. Brand browsers

### 3.1 Where things live
```
~/.config/bb/brands.yaml                         registry (you can edit by hand)
~/Library/Application Support/bb/profiles/<slug>/ Chrome user-data-dir per brand (the precious bit)
~/Library/Application Support/bb/bb.sqlite       queue, pacing ledger, audit, health
~/Library/Application Support/bb/screens/         audit + approval screenshots
~/bb-media/                                       optional drop folder (any path works)
```
Time Machine backs these up. Cookies are encrypted with the Mac's Keychain key (same as your
normal Chrome), so a stolen backup without the Keychain is useless — and it also means profiles
only work on this Mac (§13).

### 3.2 Launch (one Chrome *instance* per brand, not a Chrome profile inside your main Chrome)
```
open -na "Google Chrome" --args \
  --user-data-dir="~/Library/Application Support/bb/profiles/ascend" \
  --remote-debugging-port=9302 \
  --no-first-run --no-default-browser-check \
  --disable-backgrounding-occluded-windows \   # the IG upload stall when Chrome is covered
  --disable-renderer-backgrounding \
  --disable-background-timer-throttling \
  --disable-features=Translate,MediaRouter \
  --renderer-process-limit=4 \                 # cap RAM (tuned in Phase 0)
  bb://start
```
- Separate `--user-data-dir` = separate cookies, storage, history, extensions. Your personal Chrome
  is untouched. (Chrome 136+ refuses remote debugging on the *default* profile, so this is required anyway.)
- **No managed Chrome policies**: on macOS they'd apply to your personal Chrome too. Per-brand
  settings go into each profile's `Preferences` before first launch (restore last session so session
  cookies survive restarts; downloads → `~/Downloads/bb/<slug>`; password manager off; theme colour).
- CDP listens on 127.0.0.1 only; Chrome rejects web-page origins on that socket. Any *local*
  process could still drive it — same trust level as your user account (§11).

### 3.3 Telling brands apart
- **Theme colour** per brand (FF lime-on-ink, Ascend, LEWIX… from the brand kits on disk).
- **Launcher apps**: `bb install-launchers` generates `~/Applications/Brand Browsers/<Brand>.app`
  — tiny app bundles that run `bb open <slug>`, with the **real brand mark as the icon** (from the
  existing kits: AscPeps/brand, FF, LEWIX). Spotlight "Ascend" → Ascend's browser.
- Window title prefix via the start page: `[ASCEND]`.
- Known limit: Cmd-Tab shows every instance as "Google Chrome" (copying Chrome.app to rename it breaks
  its signature and updates — not doing that).

### 3.4 `brands.yaml`
```yaml
defaults: { maxAwake: 1, idleCloseMin: 10, approval: true }
brands:
  - slug: ff
    name: FF Dev Studio
    color: "#C6F432"
    port: 9301
    icon: ~/Desktop/dev/FFDevStudio/brand/mark.png      # resolved from the kit in Phase 1
    accounts:
      - { platform: instagram, handle: ffdev.studio, tier: new }
      - { platform: facebook,  page: "FF Dev Studio", tier: new }
      - { platform: tiktok,    handle: ffdev.studio, tier: new }
  - slug: ascend
    name: Ascend MY
    port: 9302
    accounts: [ … ]
```

---

## 4. CLI (`bb`)
| Command | Does |
|---|---|
| `bb list` | Brands, awake/asleep, login health per platform. |
| `bb open <brand> [platform]` | Wakes the brand (closing LRU if over `maxAwake`), fronts its window, opens the platform tab. |
| `bb close <brand>` / `bb close --all` | Graceful quit (profile flushed). |
| `bb add <brand>` | Creates profile dir, assigns port, writes Preferences, adds to yaml. |
| `bb login <brand>` | Opens every platform's login page for that brand so you log in once. |
| `bb health [brand]` | Cookie check (§7). |
| `bb post …` / `bb queue` | Create / list scheduled posts (§6). |
| `bb approve <id>` | Approve a draft (shows the preview screenshot first). |
| `bb install-launchers` | Builds the Spotlight/Dock apps. |
| `bb import-profile <brand> <chrome-profile-dir>` | Seeds a brand from an existing Chrome profile (e.g. your "Work" one with FF logged in) — Phase 0 confirms it works. |

---

## 5. MCP server (what Claude uses)

Registered once in Claude Code (user scope, stdio): `claude mcp add bb -- bb mcp`.

| Group | Tools (every one takes `brand`) |
|---|---|
| Brands | `brands_list`, `brand_open`, `brand_close`, `brand_health` |
| Browser | `tabs`, `tab_open`, `tab_select`, `tab_close`, `navigate`, `snapshot` (a11y tree + refs), `click`, `type`, `press`, `scroll`, `wait_for`, `screenshot`, `page_text`, `eval` (audited) |
| Files | `upload(path, ref?)` — attaches a local file directly to the page's file input (no picker, no FB input hack) · `media_find(query)` searches FFAds output + `~/bb-media` |
| Posting | `post_draft` (runs a recipe up to the final button, returns screenshot), `post_publish(draftId)` (only after approval), `post_schedule`, `queue_list`, `post_cancel` |
| Audit | `audit_tail` |

### Guardrails (in code, not in the prompt)
1. **Brand lock**: a Claude session binds to the first brand it opens; switching brands needs an
   explicit `brand_open` that ends the previous binding (no silent cross-brand calls).
2. **Handle check** before any publish: the page's active account must equal the yaml handle.
3. **Pacing ledger** (SQLite) per account: new accounts ≥ 60 min between posts per platform and
   ≤ 3/day; established ≥ 20 min, ≤ 10/day; ±10 min jitter. `post_publish` refuses early.
   (Numbers from the 29 Sep FB limit + IG human-check.)
4. **Checkpoint stop**: challenge/checkpoint URLs, captcha frames (reCAPTCHA, hCaptcha, Arkose,
   TikTok slider) and phrases ("Confirm you're human", "We limit how often", "Please wait") → stop,
   screenshot, macOS notification, window fronted for you. Never solved.
5. **Off-limits pages**: settings, password, 2FA, login activity, payments/ads billing, deactivation
   → `navigate`/`click` refused.
6. **Approval**: `post_publish` needs a draft approved by you — `bb approve` in a terminal, or the
   native macOS dialog the server raises showing the preview ("Publish to @ascend.my on Instagram?").
   Claude can't click that dialog for you. Per-brand `approval: false` once you trust it.
7. **Audit**: every tool call (brand, args, result) + screenshots on state-changing steps.

---

## 6. Posting recipes & queue

### 6.1 Recipes (deterministic Playwright, no LLM needed)
`instagram.reel`, `instagram.carousel`, `facebook.reel` (Business Suite composer), `facebook.post`,
`tiktok.video` (TikTok Studio) first; later `youtube.short`, `threads.post`, `x.post`,
`linkedin.post`. Each: preflight (logged in? right handle?) → composer → `setInputFiles` →
caption → options → **stop before Share (draft)** → after approval: publish → capture post URL.
Encodes the traps already learned: IG Escape opens "Discard post?", IG crop → Original, TikTok
prefills the description with the filename, FB reel cover frame. If a recipe breaks (platform UI
changed), Claude takes over the same tab through the MCP tools, or you do.

### 6.2 Queue
- `bb post --brand ff --platform instagram,facebook,tiktok --file reel.mp4 --caption-file cap.txt --at "2026-10-14 20:00"`
  → creates a draft per platform; **approve at scheduling time** (preview screenshots), then it runs
  unattended at the slot.
- **launchd** agent runs `bb queue tick` every minute: due + approved + pacing OK → open brand →
  publish → close brand → notify. One post at a time.
- **Mac asleep or lid closed = no posting.** Missed slots run when it wakes, re-paced. Optional:
  `pmset repeat wake` for a fixed daily posting window.

---

## 7. Login health
Reads each platform's session cookie **presence + expiry** over CDP (no page loads): IG `sessionid`,
FB `c_user`+`xs`, TikTok `sessionid`, X `auth_token`, LinkedIn `li_at`, YouTube `__Secure-3PSID`
(names confirmed in Phase 0). Runs whenever a brand opens, plus a daily `bb health` via launchd
that wakes each brand in turn for a few seconds (one at a time, RAM-safe). States: ok / expiring
(< 7 days) / expired → macOS notification "Ascend → TikTok needs relogin". Relogin is always you.

---

## 8. Media
No transfer step: Chrome is on the same disk. `upload` takes any path — FFAds `out/` renders,
`~/bb-media`, Downloads. `media_find` indexes those folders (name, duration, size, aspect via
`ffprobe`) and flags platform mismatches (IG reel 9:16, H.264/HEVC, length bounds) before upload.

---

## 9. Repo & stack
```
src/core      registry, launcher, cdp, guardrails, pacing, audit, health
src/recipes   one file per platform/action + checkpoint detectors
src/cli       commander commands
src/mcp       MCP server (stdio)
launchers/    app-bundle template + icon builder
docs/
```
| Area | Pick |
|---|---|
| Runtime | Node 24+ (this Mac has 26), TypeScript, pnpm, `tsx` for dev |
| Browser control | `playwright-core` `chromium.connectOverCDP` |
| MCP | `@modelcontextprotocol/sdk` (stdio) |
| DB | `better-sqlite3` |
| CLI | `commander`, `zod` for yaml validation, `yaml` |
| Media | `ffprobe` (Homebrew ffmpeg) |
| Notifications / dialogs | `osascript` (display notification / display dialog) |
| Scheduling | launchd plist in `~/Library/LaunchAgents/` |
| Tests | `vitest` (pacing, lease/lock, detectors on saved HTML fixtures), recipe dry-runs on real accounts (stop before Share) |

---

## 10. Phases

### Phase 0 — Checks on this Mac (1 session)
1. Two brand Chromes at once, separate dirs + ports, both driven via `connectOverCDP`. **Measure RAM**
   with IG + FB + TikTok open → sets `maxAwake` and the tab policy.
2. Throttling flags work on macOS: covered window keeps `visibilityState`/timers running and an IG
   upload completes behind the Claude window (measured, not eyeballed).
3. `setInputFiles` uploads on FB, IG, TikTok composers.
4. Seeding a brand from your existing "Work" Chrome profile keeps the FF logins (else: log in once).
5. Per-brand theme colour via `Preferences`; session restore keeps session cookies across quit/relaunch.
6. Confirm the login-cookie names.
**Exit:** `docs/PHASE0.md` with numbers.

### Phase 1 — Brands (1–2 sessions)
Registry, `bb add/open/close/list/login`, LRU + idle close, launcher apps with brand-kit icons.
**Accept:** Spotlight "Ascend" opens Ascend's own Chrome; opening FF too closes the older one when `maxAwake: 1`.

### Phase 2 — MCP (1–2 sessions)
All §5 tools, brand lock, off-limits URLs, audit.
**Accept:** Claude Code uploads an FFAds reel into the FB composer of the right brand with no picker, and refuses a call for another brand mid-session.

### Phase 3 — Recipes + approval (2–3 sessions)
IG reel/carousel, FB reel, TikTok video; draft → approval dialog → publish; checkpoint stop; handle check.
**Accept:** one real FF post per platform through `post_draft` → approve → `post_publish`, paced.

### Phase 4 — Queue + health (1–2 sessions)
launchd queue tick, scheduling CLI, cookie health + notifications.
**Accept:** a week of scheduled FF posts with zero wrong-account posts and zero rate-limit flags.

### Phase 5 — More platforms, as needed
YouTube Shorts, Threads, X, LinkedIn; optionally the Windows PC as an always-on poster (same code,
Chrome + Node run there too) so posting doesn't depend on the MacBook being open.

---

## 11. Security
- Profiles are as sensitive as your logged-in phone: FileVault on, Time Machine encrypted.
- CDP ports: localhost only, web pages can't use them; any app running as you could — same as
  anything else in your account. `bb close` when not using brands reduces the window.
- No extensions in brand browsers; password manager off inside them (relogin via your own manager).
- MCP guardrails (§5) + audit log; the server never exposes cookie values.

---

## 12. Risks
| Risk | Mitigation |
|---|---|
| 8 GB pressure → swap, sluggish Mac | maxAwake 1, tabs on demand, idle close, measured in Phase 0. |
| Platform UI change breaks a recipe | Claude/you take over the tab; fix the recipe; detectors fail loudly, never post blind. |
| Mac asleep at post time | Catch-up with pacing; optional scheduled wake; Phase 5 Windows poster. |
| Automation vs platform terms | Human pace, approval, real accounts, your real connection. Accept residual risk knowingly. |

---

## 13. What this version gives up (vs Dalang)
- Not reachable from your phone or other machines; profiles live on this Mac only (Keychain-bound).
- Posting needs the Mac awake.
- Limited by 8 GB to ~1–2 brands open at once.
If any of those starts to hurt, the Dalang plan is the upgrade path; the recipes and guardrails
port across unchanged.

---

## 14. Decisions
| # | Decision | Recommendation |
|---|---|---|
| L1 | Name | see chat |
| L2 | First brands | FF + Ascend |
| L3 | `maxAwake` | 1 (raise after Phase 0 if RAM allows) |
| L4 | Approval default | On |
| L5 | Seed FF from your existing "Work" Chrome profile or log in fresh | Seed (if Phase 0 confirms) |
