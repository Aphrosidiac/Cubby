// The guardrails from PLAN §8, as the Claude page explains them. Read-only: they live in CORE.
export const GUARDRAILS: { icon: string; title: string; body: string }[] = [
  { icon: 'lock', title: 'Brand lock', body: 'A Claude session binds to one brand. Touching another brand fails until Claude explicitly switches — no accidental cross-posting.' },
  { icon: 'users', title: 'Handle check', body: 'Before anything is published, the account shown on the page must match the brand’s account. A mismatch stops the run.' },
  { icon: 'clock', title: 'Pacing', body: 'Per-account gaps and daily caps (new accounts: 60 min apart, 3 a day; established: 20 min, 10 a day; ±10 min jitter). Editable in Settings.' },
  { icon: 'warn', title: 'Checkpoint stop', body: 'Challenge pages, captchas, “confirm you’re human” or rate-limit walls stop the run, bring the window to front and notify you. Never solved by the app.' },
  { icon: 'shield', title: 'Off-limits pages', body: 'Account settings, password, 2FA, login activity, billing and deactivation pages are refused for Claude.' },
  { icon: 'approve', title: 'Approval', body: 'Publishing goes through the Approvals inbox for brands that need it. Claude can create and prepare posts; only you approve.' },
  { icon: 'key', title: 'No secrets to Claude', body: 'No tool returns passwords, 2FA codes or cookie values. Fill login and Reveal are app-only.' },
  { icon: 'stop', title: 'Kill switch + audit', body: 'Stop aborts every Claude action, flow and recipe at once. Everything Claude does is written to Activity.' }
];
