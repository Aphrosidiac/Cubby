// Minimal RFC 4180 CSV parse / stringify (quotes, escaped quotes, CRLF, BOM).

export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let q = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else q = false
      } else field += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((c) => c !== '')) rows.push(row)
  return rows
}

/** Rows as objects keyed by the lower-cased, trimmed header. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const [head, ...rest] = parseCsv(text)
  if (!head) return []
  const keys = head.map((h) => h.trim().toLowerCase())
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
}
