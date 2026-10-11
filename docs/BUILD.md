# Cubby — build conventions

Read `docs/PLAN.md` first (what the app does). This file is how the code is shaped.

## Layout

```
src/shared/      contract.ts (every command: zod input + output type, events), types.ts, platforms.ts,
                 csv.ts, checkpoints.ts, pacing.ts — pure TS, no Node/Electron imports, unit-tested
src/main/        Electron main process
  core/          db (node:sqlite), migrations, registry (implement/invoke), events, activity,
                 settings, runtime (kill switch, status), notify, paths, ids, errors
  modules/<m>/   one folder per module; index.ts calls implement({...}) and exports start()/stop()
                 plus the module's public functions used by other modules
  index.ts       app lifecycle · windows.ts (main window, quick switcher) · tray.ts · ipc.ts · protocol.ts
src/preload/     the bridge: invoke(command, input), onEvent(fn), pathForFile(file)
src/renderer/    Vue 3 app: pages/, components/ui (FF Ops kit), components/shell, lib/api.ts, lib/store.ts
```

## Rules

1. **Contract first.** A capability = a command in `src/shared/contract.ts`. Implement it once with
   `implement({ 'name': (input, ctx) => … })` in its module. Input is already validated and defaulted.
2. **Never bypass the registry** from a door. IPC, Local API and MCP call `invoke(name, input, ctx)`.
   Inside CORE, modules call each other's exported functions directly (no double logging).
3. **Guardrails live in CORE** (registry + runs + tools), keyed off `ctx.actor`. Doors only authenticate.
4. **Errors for people:** throw `UserError(message)` / `GuardrailError(message, rule)`; messages are shown verbatim.
5. **Events:** after a mutation emit the matching event from `EventMap` (`brands.changed`, `posts.changed`, …)
   and call `requestStatus()` if an AppStatus field may have changed.
6. **SQLite:** `db.all/get/run/tx` (sync). JSON columns via `j()` / `pj()`. New tables or columns = a NEW
   migration appended to `core/migrations.ts`, never an edit.
7. **Secrets** never leave main except Reveal (actor `you`, unlock required). No command returns cookie
   values, passwords or TOTP secrets to `claude` / `api`.
8. **No new dependencies** without need; everything planned is installed (see package.json).
9. **Renderer:** `api('command', input)` is typed end-to-end; `useLoad(fn, { topics: ['brands.changed'] })`
   keeps screens live. Use the FF Ops kit in `components/ui` (Btn, Field, Select, Modal, Drawer, DataTable,
   Tabs, Segmented, Toggle, Chip, Menu, Picker, PageHeader, EmptyState, Stepper, FileDrop, CopyField, Toasts,
   confirm()). Tokens in `styles/tokens.css`; never raw font sizes (use `--fs-*`).
10. **Brace every loop/if body** that contains an await or a call into a stubbed module (rollup bug seen).

## Commands

```bash
pnpm dev            # electron-vite dev (HMR)
pnpm typecheck      # main + renderer
pnpm test           # vitest
pnpm build          # bundles into out/
pnpm build:win      # NSIS installer into release/
```

`CUBBY_DATA_DIR=<dir>` runs the app on a separate data folder (tests, e2e). Dev builds use
`%APPDATA%/Cubby Dev`, installed builds `%APPDATA%/Cubby`.
