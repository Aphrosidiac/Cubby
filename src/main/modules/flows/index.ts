// OWNER: automation module builder.
// Flows (PLAN 6.8): CRUD, step-list engine on the run manager, recorder (CDP init script captures clicks/typing/navigation in the brand window and turns them into FlowSteps), schedules via croner (next_run_at), recipes list, runs list/get/abort.
// Implements commands: flows.*, runs.*
import { implement } from '../../core/registry'

implement({})

export function start(): void {}
export async function stop(): Promise<void> {}
