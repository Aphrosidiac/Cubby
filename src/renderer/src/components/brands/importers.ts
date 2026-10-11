// Bringing brands in: CSV batch create (read in the renderer with the File API, sent as text) and
// encrypted .brand imports. Shared by Home, the New brand wizard and Settings → Backups.
import { toCsv } from '@shared/csv';
import { api } from '@/lib/api';
import { confirm } from '@/composables/confirm';
import { fail, ok, toast } from '@/composables/toast';

export const CSV_COLUMNS = ['name', 'group', 'tags', 'notes', 'color', 'approval', 'startup_urls', 'age_tier', 'instagram', 'facebook', 'tiktok', 'youtube', 'x', 'linkedin', 'threads'];

/** Download a filled-in example CSV for batch create. */
export function downloadCsvTemplate(): void {
  const csv = toCsv([
    CSV_COLUMNS,
    ['FF Dev Studio', 'Studio', 'agency;portfolio', 'Main studio accounts', '#0b0b0a', 'yes', 'https://www.instagram.com/', 'established', 'ffdev.studio', 'ffdevstudio', '', '', '', 'company/ffdev', ''],
    ['Ascend Resources', 'Clients', 'client;malaysia', '', '#2c4f9c', 'yes', '', 'new', 'ascend.my', '', 'ascend.my', '', '', '', '']
  ]);
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cubby-brands-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Ask for a .csv with a hidden file input and create its brands. Resolves with how many were made. */
export function pickCsvAndCreate(): Promise<number> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(0);
      try {
        const text = await f.text();
        const r = await api('brands.batchCreateCsv', { csv: text });
        if (r.errors.length) toast(`Created ${r.created}, ${r.errors.length} row${r.errors.length === 1 ? '' : 's'} skipped`, { tone: r.created ? 'warn' : 'bad', body: r.errors.slice(0, 4).join(' · ') + (r.errors.length > 4 ? ` · and ${r.errors.length - 4} more` : ''), ms: 12000 });
        else ok(`Created ${r.created} brand${r.created === 1 ? '' : 's'} from ${f.name}`);
        resolve(r.created);
      } catch (e) { fail(e, 'Could not import that CSV'); resolve(0); }
    };
    input.click();
  });
}

/** Pick an encrypted .brand export (or use `given`, e.g. a file double-clicked in Explorer), ask its passphrase, import. */
export async function importBrandFile(given?: string): Promise<number> {
  try {
    const path = (typeof given === 'string' ? given : undefined) ?? (await api('app.pickFiles', { filters: [{ name: 'Cubby brand export', extensions: ['brand'] }] }))[0];
    if (!path) return 0;
    const passphrase = await confirm({ title: 'Import brands', body: `${path.split(/[\\/]/).pop()}\nEnter the passphrase it was exported with.`, confirm: 'Import', input: { label: 'Passphrase', password: true } });
    if (!passphrase) return 0;
    const rows = await api('transfer.import', { path, passphrase });
    ok(`Imported ${rows.length} brand${rows.length === 1 ? '' : 's'}`, rows.map(r => r.name).join(', '));
    return rows.length;
  } catch (e) { fail(e, 'Import failed'); return 0; }
}
