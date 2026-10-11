// Flow step catalogue for the editor: names, icons, blank defaults and the checks a step must pass
// before a flow can be saved. Mirrors the FlowStep union in shared/types.ts.
import type { FlowStep, FlowStepType } from '@shared/types';

export interface StepMeta { type: FlowStepType; label: string; icon: string; hint: string; group: 'Browser' | 'Logic' | 'Media & recipes' | 'People' }

export const STEP_META: Record<FlowStepType, StepMeta> = {
  open_brand: { type: 'open_brand', label: 'Open brand', icon: 'open', hint: 'Open the brand’s Chrome window (or reuse it).', group: 'Browser' },
  open_url: { type: 'open_url', label: 'Open URL', icon: 'globe', hint: 'Go to a page in the brand window.', group: 'Browser' },
  click: { type: 'click', label: 'Click', icon: 'target', hint: 'Click an element by selector or visible text.', group: 'Browser' },
  type: { type: 'type', label: 'Type', icon: 'edit', hint: 'Type text into a field.', group: 'Browser' },
  press: { type: 'press', label: 'Press key', icon: 'api', hint: 'Press a key such as Enter or Tab.', group: 'Browser' },
  scroll: { type: 'scroll', label: 'Scroll', icon: 'rows', hint: 'Scroll the page by some pixels.', group: 'Browser' },
  upload: { type: 'upload', label: 'Upload file', icon: 'upload', hint: 'Put files into a file input (never the OS dialog).', group: 'Browser' },
  wait_for: { type: 'wait_for', label: 'Wait for', icon: 'eye', hint: 'Wait until an element or text appears.', group: 'Browser' },
  wait: { type: 'wait', label: 'Wait', icon: 'clock', hint: 'Pause for a moment.', group: 'Browser' },
  screenshot: { type: 'screenshot', label: 'Screenshot', icon: 'image', hint: 'Save a screenshot to the run.', group: 'Browser' },
  if_exists: { type: 'if_exists', label: 'If element exists', icon: 'flow', hint: 'Run steps only when something is on the page.', group: 'Logic' },
  loop_media: { type: 'loop_media', label: 'Loop over media', icon: 'refresh', hint: 'Repeat steps for each matching library file.', group: 'Media & recipes' },
  run_recipe: { type: 'run_recipe', label: 'Run recipe', icon: 'bolt', hint: 'Run one of Cubby’s built-in recipes.', group: 'Media & recipes' },
  ask_claude: { type: 'ask_claude', label: 'Ask Claude', icon: 'claude', hint: 'Hand Claude a task in this brand window.', group: 'People' },
  notify: { type: 'notify', label: 'Notify me', icon: 'bell', hint: 'Send a notification.', group: 'People' },
  close_brand: { type: 'close_brand', label: 'Close brand', icon: 'close', hint: 'Close the brand’s window.', group: 'Browser' }
};

export const STEP_ORDER: FlowStepType[] = ['open_brand', 'open_url', 'click', 'type', 'press', 'scroll', 'upload', 'wait_for', 'wait', 'screenshot', 'close_brand', 'if_exists', 'loop_media', 'run_recipe', 'ask_claude', 'notify'];

export const uid = () => `s_${Math.random().toString(36).slice(2, 10)}`;

export function newStep(type: FlowStepType): FlowStep {
  const id = uid();
  switch (type) {
    case 'open_url': return { id, type, url: 'https://' };
    case 'click': return { id, type, text: '' };
    case 'type': return { id, type, selector: '', text: '' };
    case 'press': return { id, type, key: 'Enter' };
    case 'scroll': return { id, type, dy: 600 };
    case 'upload': return { id, type, selector: 'input[type=file]', files: [] };
    case 'wait_for': return { id, type, text: '', timeoutMs: 15000 };
    case 'wait': return { id, type, ms: 1000 };
    case 'screenshot': return { id, type, label: '' };
    case 'if_exists': return { id, type, text: '', then: [], else: [] };
    case 'loop_media': return { id, type, tag: '', steps: [] };
    case 'run_recipe': return { id, type, recipe: '', params: {} };
    case 'ask_claude': return { id, type, prompt: '' };
    case 'notify': return { id, type, message: '' };
    default: return { id, type } as FlowStep;
  }
}

/** Deep copy with fresh ids (duplicate). */
export function cloneStep(s: FlowStep): FlowStep {
  const c = JSON.parse(JSON.stringify(s)) as FlowStep;
  const re = (x: FlowStep) => {
    x.id = uid();
    if (x.type === 'if_exists') { x.then.forEach(re); x.else?.forEach(re); }
    if (x.type === 'loop_media') x.steps.forEach(re);
  };
  re(c);
  return c;
}

const blank = (v?: string) => !v || !v.trim();

/** step id → message, for every step (nested too) that can't run as written. */
export function validateSteps(steps: FlowStep[], out: Record<string, string> = {}): Record<string, string> {
  for (const s of steps) {
    switch (s.type) {
      case 'open_url': if (blank(s.url) || s.url.trim() === 'https://') out[s.id] = 'Enter the address to open'; break;
      case 'click': if (blank(s.selector) && blank(s.text)) out[s.id] = 'Give a selector or the visible text to click'; break;
      case 'type': if (s.text === undefined || s.text === '') out[s.id] = 'Enter the text to type'; break;
      case 'press': if (blank(s.key)) out[s.id] = 'Name the key, e.g. Enter'; break;
      case 'scroll': if (!Number.isFinite(s.dy) || s.dy === 0) out[s.id] = 'Scroll by a number of pixels (negative = up)'; break;
      case 'upload': if (blank(s.selector)) out[s.id] = 'Give the file input’s selector'; else if (!s.files.length) out[s.id] = 'Choose at least one file'; break;
      case 'wait_for': if (blank(s.selector) && blank(s.text)) out[s.id] = 'Give a selector or text to wait for'; break;
      case 'wait': if (!Number.isFinite(s.ms) || s.ms <= 0) out[s.id] = 'Wait a positive number of milliseconds'; else if (s.ms > 600_000) out[s.id] = 'Waits are capped at 10 minutes'; break;
      case 'if_exists': if (blank(s.selector) && blank(s.text)) out[s.id] = 'Give a selector or text to look for'; validateSteps(s.then, out); validateSteps(s.else ?? [], out); break;
      case 'loop_media': if (!s.assetIds?.length && blank(s.tag)) out[s.id] = 'Choose a media tag to loop over'; validateSteps(s.steps, out); break;
      case 'run_recipe': if (blank(s.recipe)) out[s.id] = 'Choose a recipe'; break;
      case 'ask_claude': if (blank(s.prompt)) out[s.id] = 'Tell Claude what to do'; break;
      case 'notify': if (blank(s.message)) out[s.id] = 'Write the notification'; break;
    }
  }
  return out;
}

/** One-line summary shown on a collapsed card and in run logs. */
export function stepSummary(s: FlowStep): string {
  switch (s.type) {
    case 'open_url': return s.url;
    case 'click': return s.text ? `“${s.text}”` : s.selector ?? '';
    case 'type': return `${s.text ? `“${s.text.slice(0, 40)}”` : ''}${s.selector ? ` into ${s.selector}` : ''}`;
    case 'press': return s.key;
    case 'scroll': return `${s.dy > 0 ? 'down' : 'up'} ${Math.abs(s.dy)} px`;
    case 'upload': return `${s.files.length} file${s.files.length === 1 ? '' : 's'}`;
    case 'wait_for': return s.text ? `“${s.text}”` : s.selector ?? '';
    case 'wait': return `${s.ms >= 1000 ? `${s.ms / 1000}s` : `${s.ms} ms`}`;
    case 'screenshot': return s.label ?? '';
    case 'if_exists': return s.text ? `“${s.text}”` : s.selector ?? '';
    case 'loop_media': return s.tag ? `#${s.tag}` : `${s.assetIds?.length ?? 0} files`;
    case 'run_recipe': return s.recipe;
    case 'ask_claude': return s.prompt.slice(0, 60);
    case 'notify': return s.message.slice(0, 60);
    default: return '';
  }
}

export const countSteps = (steps: FlowStep[]): number =>
  steps.reduce((n, s) => n + 1 + (s.type === 'if_exists' ? countSteps(s.then) + countSteps(s.else ?? []) : s.type === 'loop_media' ? countSteps(s.steps) : 0), 0);
