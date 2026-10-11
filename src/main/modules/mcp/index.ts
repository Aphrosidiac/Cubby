// OWNER: doors module builder.
// MCP server (PLAN 8): @modelcontextprotocol/sdk Streamable HTTP on the api server, one McpServer per session, tools map onto invoke() with actor claude + the session brand lock, runtime.mcpClients bookkeeping; claude.connect writes the Claude Code MCP entry.
// Implements commands: claude.connect
import { implement } from '../../core/registry'

implement({})

export function start(): void {}
export async function stop(): Promise<void> {}
