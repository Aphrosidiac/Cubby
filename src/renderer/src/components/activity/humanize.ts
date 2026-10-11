// Activity rows store the command name (posts.create, brands.open.failed …) plus a redacted input.
// These turn them into a sentence and a one-line detail a person can scan.
import type { Activity } from '@shared/types';
import { dateTime, plural } from '@/lib/format';

const VERBS: Record<string, string> = {
  'app.killSwitch': 'Kill switch',
  'settings.set': 'Changed settings', 'settings.setUnlockPassphrase': 'Set the unlock passphrase', 'settings.setBackupPassphrase': 'Set the backup passphrase',
  'brands.create': 'Created brand', 'brands.update': 'Updated brand', 'brands.delete': 'Moved brand to the recycle bin', 'brands.restore': 'Restored brand',
  'brands.purge': 'Deleted brand forever', 'brands.reorder': 'Reordered brands', 'brands.batchCreateCsv': 'Imported brands from CSV', 'brands.open': 'Opened brand',
  'brands.close': 'Closed brand', 'brands.closeAll': 'Closed every brand', 'brands.arrange': 'Arranged windows', 'brands.batch': 'Batch action on brands', 'brands.openUrl': 'Opened a page',
  'groups.create': 'Created group', 'groups.update': 'Updated group', 'groups.delete': 'Deleted group',
  'tags.create': 'Created tag', 'tags.update': 'Updated tag', 'tags.delete': 'Deleted tag',
  'accounts.create': 'Added account', 'accounts.update': 'Updated account', 'accounts.delete': 'Removed account', 'accounts.reveal': 'Revealed saved login', 'accounts.fillLogin': 'Filled login',
  'health.check': 'Checked logins', 'health.relogin_needed': 'Login needs renewing',
  'cookies.export': 'Exported cookies', 'cookies.import': 'Imported cookies', 'cookies.clear': 'Cleared site data',
  'browser.tabOpen': 'Opened a tab', 'browser.tabSelect': 'Switched tab', 'browser.tabClose': 'Closed a tab', 'browser.navigate': 'Navigated', 'browser.click': 'Clicked',
  'browser.type': 'Typed', 'browser.press': 'Pressed a key', 'browser.scroll': 'Scrolled', 'browser.upload': 'Uploaded a file',
  'media.add': 'Added media', 'media.update': 'Tagged media', 'media.remove': 'Removed media', 'media.rescan': 'Rescanned media', 'media.addFolder': 'Watching a folder', 'media.removeFolder': 'Stopped watching a folder',
  'posts.create': 'Created post', 'posts.update': 'Edited post', 'posts.delete': 'Deleted post', 'posts.prepare': 'Prepared post', 'posts.approve': 'Approved post',
  'posts.reject': 'Rejected post', 'posts.run': 'Published post', 'posts.cancel': 'Cancelled post', 'posts.reschedule': 'Rescheduled post',
  'slots.set': 'Changed posting slots', 'pacing.setRules': 'Changed pacing rules',
  'flows.create': 'Created flow', 'flows.update': 'Edited flow', 'flows.delete': 'Deleted flow', 'flows.duplicate': 'Duplicated flow', 'flows.run': 'Ran flow',
  'flows.runRecipe': 'Ran recipe', 'flows.recordStart': 'Started recording', 'flows.recordStop': 'Stopped recording', 'runs.abort': 'Aborted run',
  'tokens.create': 'Created API token', 'tokens.revoke': 'Revoked API token', 'claude.connect': 'Connected Claude Code',
  'activity.exportCsv': 'Exported activity', 'backup.run': 'Backed up', 'backup.restore': 'Restored a backup', 'transfer.export': 'Exported brands', 'transfer.import': 'Imported brands',
  'guardrail.checkpoint': 'Stopped at a checkpoint', 'guardrail.off_limits': 'Refused an off-limits page',
  // logged by the scheduler, MCP and pacing rather than a command
  'flow.scheduled_run': 'Ran scheduled flow', 'mcp.connected': 'Claude connected', 'mcp.brandSwitch': 'Switched brand',
  'posts.missed': 'Missed a scheduled post', 'posts.repaced': 'Moved a post to keep pacing', 'posts.submit': 'Submitted post',
  // read-only commands appear only when a guardrail refused them
  'browser.snapshot': 'Read the page', 'browser.screenshot': 'Took a screenshot', 'browser.pageText': 'Read the page text', 'browser.tabs': 'Listed tabs',
  'browser.waitFor': 'Waited for the page', 'brands.front': 'Brought brand to front', 'brands.list': 'Listed brands', 'brands.get': 'Looked up brand',
  'posts.list': 'Listed posts', 'media.list': 'Searched media', 'flows.list': 'Listed flows', 'activity.list': 'Read activity'
};

/** GuardrailError rules (core) → what stopped the action. */
const RULES: Record<string, string> = {
  off_limits: 'Off-limits page', brand_lock: 'Brand lock', kill_switch: 'Kill switch', checkpoint: 'Checkpoint',
  handle_check: 'Wrong account', no_secrets: 'Secrets withheld', pacing: 'Pacing', unsupported: 'Not supported'
};

export function humanAction(a: Pick<Activity, 'action' | 'detail'>): { text: string; failed: boolean; guard: boolean } {
  const failed = a.action.endsWith('.failed');
  const base = failed ? a.action.slice(0, -'.failed'.length) : a.action;
  const guard = base.startsWith('guardrail.') || !!(a.detail as { rule?: string })?.rule;
  let text = VERBS[base];
  if (base === 'app.killSwitch') text = (a.detail?.input as { on?: boolean } | undefined)?.on ? 'Stopped all automation' : 'Resumed automation';
  if (!text) {
    const [mod, verb = ''] = base.split('.');
    text = `${mod.charAt(0).toUpperCase()}${mod.slice(1)} · ${verb.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase()}`;
  }
  // a guardrail refusal reads "Blocked: navigated" (the detail line names the guardrail)
  if (failed && guard) return { text: `Blocked: ${text.charAt(0).toLowerCase()}${text.slice(1)}`, failed, guard };
  return { text: failed ? `Failed: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text, failed, guard };
}

/** quietHours → "quiet hours" */
const words = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
const pick = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);

/** A short line from the redacted input / error: the caption, the URL, the name — whatever identifies it. */
export function detailLine(a: Pick<Activity, 'action' | 'detail'>): string {
  const d = a.detail ?? {};
  const err = pick(d, 'error');
  const rule = pick(d, 'rule');
  const label = typeof rule === 'string' ? RULES[rule] : undefined;
  if (typeof err === 'string') return label && !err.toLowerCase().startsWith(label.toLowerCase()) ? `${label} · ${err}` : err;
  const input = pick(d, 'input');
  for (const k of ['name', 'caption', 'url', 'handle', 'message', 'recipe', 'path', 'reason', 'scheduledAt', 'key', 'value', 'mode']) {
    const v = pick(input, k);
    if (typeof v !== 'string' || !v.trim()) continue;
    // a timestamp reads as wall time in the person's zone ("for 12 Oct, 8:00 pm"), never raw ISO
    if (k === 'scheduledAt') return `for ${dateTime(v)}`;
    return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  const patch = pick(input, 'patch');
  if (patch && typeof patch === 'object') return `changed ${Object.keys(patch).map(words).join(', ')}`;
  const ids = pick(input, 'ids');
  if (Array.isArray(ids)) return plural(ids.length, 'item');
  const paths = pick(input, 'paths');
  if (Array.isArray(paths)) return plural(paths.length, 'file');
  const reason = pick(d, 'reason');
  if (typeof reason === 'string') return reason;
  return '';
}
