export interface Column { key: string; label: string; align?: 'left' | 'right' | 'center'; width?: string; class?: string; sortable?: boolean; hideSm?: boolean;
  /** Phone card layout (≤640px): lead = leading badge, main = title line, sub = lines under it, end / end2 = right column top / second line. Defaults: first column main, hideSm hidden, last right-aligned column end, the rest sub. */
  sm?: 'lead' | 'main' | 'sub' | 'end' | 'end2' | 'hide' }
export interface MenuItem { label: string; icon?: string; run?: () => void; to?: string; href?: string; download?: boolean; danger?: boolean; disabled?: boolean; divider?: boolean; hint?: string }
export interface Option { value: string; label: string; sub?: string | null; group?: string }
export interface Line { description: string; detail?: string | null; qty: number; unitPrice: number; optional?: boolean; accountId?: string | null; _k?: string }
