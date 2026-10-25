// ===== Pure backup logic (testable without the desktop window) =====

export const SQLITE_HEADER = 'SQLite format 3';

/** Check the first bytes of a file for the SQLite magic header. */
export function isValidSqliteHeader(bytes: Uint8Array | number[]): boolean {
  const magic = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0];
  const b = Array.from(bytes.slice(0, 16));
  if (b.length < 16) return false;
  return magic.every((m, i) => b[i] === m);
}

/** sports-store-backup-YYYY-MM-DD.db (local date) */
export function backupFileName(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `sports-store-backup-${y}-${m}-${d}.db`;
}

/** Keep only the newest `keep` entries (by parsed date in the name, fallback to mtimeMs). */
export function selectKeepLast<T extends { name: string; mtimeMs?: number }>(files: T[], keep = 14): { keep: T[]; remove: T[] } {
  const dated = files.map((f) => {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(f.name);
    const t = m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T23:59:59`) : (f.mtimeMs ?? 0);
    return { f, t };
  });
  dated.sort((a, b) => b.t - a.t); // newest first
  return { keep: dated.slice(0, keep).map((x) => x.f), remove: dated.slice(keep).map((x) => x.f) };
}

/** True when the last automatic backup is older than `hours`. */
export function shouldAutoBackup(lastBackupIso: string | null | undefined, now: Date = new Date(), hours = 24): boolean {
  if (!lastBackupIso) return true;
  const t = Date.parse(lastBackupIso.replace(' ', 'T'));
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > hours * 3600_000;
}
