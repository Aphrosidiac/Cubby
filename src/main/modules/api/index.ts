// OWNER: doors module builder.
// Local API (PLAN 7): fastify on 127.0.0.1:Settings.apiPort, Bearer token auth via tokens module, REST routes mapped onto invoke(), MCP mounted at /mcp (modules/mcp), runtime.apiListening + requestStatus().
// Implements commands: none directly (it is a door)
import { implement } from '../../core/registry'

implement({})

export function start(): void {}
export async function stop(): Promise<void> {}
