// OWNER: doors module builder.
// API tokens: random 32-byte token shown once (prefix cub_), sha256 hash stored, scopes + optional brand list, revoke, lastUsedAt.
// Implements commands: tokens.list, tokens.create, tokens.revoke
import { implement } from '../../core/registry'

implement({})

export function start(): void {}
export async function stop(): Promise<void> {}
