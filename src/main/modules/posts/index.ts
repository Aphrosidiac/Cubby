// OWNER: posting module builder.
// Composer + approvals + queue (PLAN 6.4-6.6, 10): posts CRUD, fit checks, prepare (posting recipe in mode prepare -> screenshots -> ready_for_approval + notify), approve/reject, run (publish via recipe, pacing + handle check, results, ledger), slots + next free slot, reschedule.
// Implements commands: posts.*, slots.*
import { implement } from '../../core/registry'

implement({})

export function start(): void {}
export async function stop(): Promise<void> {}
