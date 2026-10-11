/** Words and tones for every status the API returns. One place, so every screen agrees. */
export const STATUS: Record<string, { label: string; tone: string }> = {
  // invoices
  DRAFT: { label: 'Draft', tone: 'muted' }, OPEN: { label: 'Open', tone: 'info' }, OVERDUE: { label: 'Overdue', tone: 'bad' },
  PARTIAL: { label: 'Part paid', tone: 'warn' }, PAID: { label: 'Paid', tone: 'good' }, VOID: { label: 'Void', tone: 'muted' },
  // quotes
  SENT: { label: 'Sent', tone: 'info' }, ACCEPTED: { label: 'Accepted', tone: 'good' }, DECLINED: { label: 'Declined', tone: 'bad' },
  EXPIRED: { label: 'Expired', tone: 'muted' }, INVOICED: { label: 'Invoiced', tone: 'ink' },
  // subscriptions
  PENDING: { label: 'Awaiting first payment', tone: 'warn' }, ACTIVE: { label: 'Active', tone: 'good' }, PAST_DUE: { label: 'Past due', tone: 'bad' },
  PAUSED: { label: 'Paused', tone: 'muted' }, CANCELED: { label: 'Cancelled', tone: 'muted' },
  // deals
  // (ACTIVE / PAID / EXPIRED / CANCELED shared)
  // clients
  PROSPECT: { label: 'Prospect', tone: 'info' }, PAST: { label: 'Past', tone: 'muted' }, ARCHIVED: { label: 'Archived', tone: 'muted' },
  // leads
  NEW: { label: 'New', tone: 'signal' }, CONTACTED: { label: 'Contacted', tone: 'info' }, QUALIFIED: { label: 'Qualified', tone: 'warn' },
  PROPOSAL: { label: 'Proposal', tone: 'ink' }, WON: { label: 'Won', tone: 'good' }, LOST: { label: 'Lost', tone: 'muted' }, SPAM: { label: 'Spam', tone: 'muted' },
  // campaigns
  ENDED: { label: 'Ended', tone: 'muted' },
  // requests
  IN_PROGRESS: { label: 'In progress', tone: 'warn' }, DONE: { label: 'Done', tone: 'good' },
  // payments
  SUCCEEDED: { label: 'Received', tone: 'good' }, REFUNDED: { label: 'Refunded', tone: 'muted' }, PARTIALLY_REFUNDED: { label: 'Part refunded', tone: 'warn' },
  // expenses / bank
  RECORDED: { label: 'Recorded', tone: 'good' }, UNMATCHED: { label: 'Unmatched', tone: 'warn' }, MATCHED: { label: 'Matched', tone: 'good' }, IGNORED: { label: 'Ignored', tone: 'muted' },
  // email
  QUEUED: { label: 'Queued', tone: 'warn' }, LOGGED: { label: 'Logged', tone: 'muted' }, FAILED: { label: 'Failed', tone: 'bad' },
  // project stages
  ENQUIRY: { label: 'Enquiry', tone: 'muted' }, SCOPING: { label: 'Scoping', tone: 'info' }, DEPOSIT: { label: 'Deposit', tone: 'warn' },
  BUILD: { label: 'Build', tone: 'ink' }, REVISIONS: { label: 'Revisions', tone: 'ink' }, QA: { label: 'QA', tone: 'ink' },
  FINAL_PAYMENT: { label: 'Final payment', tone: 'warn' }, LIVE: { label: 'Live', tone: 'signal' }, CARE: { label: 'Care', tone: 'good' }, CLOSED: { label: 'Closed', tone: 'muted' },
  // billing modes
  AUTO: { label: 'Auto-pay', tone: 'ink' }, MANUAL: { label: 'Invoiced', tone: 'muted' }, PREPAID: { label: 'Prepaid', tone: 'info' },
};
