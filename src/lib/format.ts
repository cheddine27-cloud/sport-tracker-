/**
 * Formatting helpers (money in whole dinars, Arabic-readable dates).
 */

/** 1600 -> "1,600 دج" */
export function formatMoney(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  const grouped = Math.round(value).toLocaleString('en-US');
  return `${grouped} دج`;
}

/**
 * ISO / SQLite datetime text ("2026-10-22 13:45:10") -> readable Arabic date
 * e.g. "٢٢ أكتوبر ٢٠٢٦، ١٣:٤٥"
 */
export function formatDate(iso: string): string {
  if (!iso) return '';
  // SQLite stores "YYYY-MM-DD HH:MM:SS"; make it parseable as local time.
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ar', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

/** Short date only: "٢٢ أكتوبر ٢٠٢٦" */
export function formatDateShort(iso: string): string {
  if (!iso) return '';
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ar', { dateStyle: 'medium' }).format(d);
}
