// Every module, in start order. Importing a module registers its commands (implement()).
import * as app from './app'
import * as brands from './brands'
import * as browser from './browser'
import * as accounts from './accounts'
import * as health from './health'
import * as media from './media'
import * as pacing from './pacing'
import * as runs from './runs'
import * as recipes from './recipes'
import * as flows from './flows'
import * as posts from './posts'
import * as tools from './tools'
import * as tokens from './tokens'
import * as mcp from './mcp'
import * as api from './api'
import * as backup from './backup'
import * as scheduler from './scheduler'

interface Module {
  start?: () => void | Promise<void>
  stop?: () => void | Promise<void>
}

const MODULES: [string, Module][] = [
  ['app', app], ['brands', brands], ['browser', browser], ['accounts', accounts], ['health', health],
  ['media', media], ['pacing', pacing], ['runs', runs], ['recipes', recipes], ['flows', flows],
  ['posts', posts], ['tools', tools], ['tokens', tokens], ['mcp', mcp], ['api', api], ['backup', backup],
  ['scheduler', scheduler]
]

export async function startModules(): Promise<void> {
  for (const [name, m] of MODULES) {
    try {
      await m.start?.()
    } catch (e) {
      console.error(`module ${name} failed to start`, e)
    }
  }
}

export async function stopModules(): Promise<void> {
  for (const [name, m] of [...MODULES].reverse()) {
    try {
      await m.stop?.()
    } catch (e) {
      console.error(`module ${name} failed to stop`, e)
    }
  }
}
