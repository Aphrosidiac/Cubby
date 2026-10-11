# Cubby

Every brand gets its own cubby: a desktop app (Windows + Mac) that gives each brand its own sealed
Google Chrome profile with that brand's full set of social logins, managed from one home window like
AdsPower — plus a posting composer, calendar, approvals, media library, automation flows, a local
API, and Claude control through MCP with guardrails.

Isolation, not disguise: no fingerprint spoofing, no proxies, no captcha solving.

## Stack

Electron 44 · electron-vite · Vue 3 (FF Ops UI kit) · `node:sqlite` (no native modules) ·
playwright-core over CDP · Fastify · MCP SDK. Why: [docs/PLAN.md §3](docs/PLAN.md).

## Develop

```bash
pnpm install
pnpm dev          # app with HMR (data in %APPDATA%/Cubby Dev)
pnpm typecheck
pnpm test
pnpm build:win    # installer in release/
```

- Plan: [docs/PLAN.md](docs/PLAN.md) · code conventions: [docs/BUILD.md](docs/BUILD.md)
- Local API + MCP: `http://127.0.0.1:7820` (`/mcp`), token from Settings → Local API or Claude → Connect Claude Code.
