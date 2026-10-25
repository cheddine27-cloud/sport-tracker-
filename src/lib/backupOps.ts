// ===== Backup/restore operations (Tauri-only; pure logic lives in src/lib/backup.ts) =====

import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, copyFile, mkdir, readDir, remove, stat, readFile } from '@tauri-apps/plugin-fs';
import { getSettings, setSetting } from '@/services/settings';
import { backupFileName, selectKeepLast, shouldAutoBackup } from '@/lib/backup';

const DB_FILE = 'sports_store.db';

export async function dbPath(): Promise<string> {
  return await join(await appDataDir(), DB_FILE);
}

/** Copy the live DB to a chosen destination path. Returns the destination. */
export async function manualBackupTo(destPath: string): Promise<string> {
  const src = await dbPath();
  if (!(await exists(src))) throw new Error('ملف قاعدة البيانات غير موجود بعد');
  await copyFile(src, destPath);
  return destPath;
}

/** Validate header, safety-backup first, then replace the live DB and reload. */
export async function restoreFrom(path: string): Promise<void> {
  const bytes = await readFile(path);
  if (!(bytes.length >= 16 && String.fromCharCode(...bytes.slice(0, 15)) === 'SQLite format 3')) {
    throw new Error('الملف المختار ليس قاعدة بيانات SQLite صالحة');
  }
  const src = await dbPath();
  // Automatic safety backup before replacing.
  if (await exists(src)) {
    await copyFile(src, await join(await appDataDir(), `pre-restore-${backupFileName()}`));
  }
  await copyFile(path, src);
  for (const suffix of ['-wal', '-shm']) {
    const p = `${src}${suffix}`;
    if (await exists(p)) await remove(p);
  }
}

/** On app start: auto-backup if older than 24h into <appData>/backups, keep last 14. */
export async function runAutoBackupIfNeeded(): Promise<{ done: boolean; path?: string }> {
  const settings = await getSettings(await getAppDb());
  if (!shouldAutoBackup(settings.lastAutoBackupAt)) return { done: false };
  const src = await dbPath();
  if (!(await exists(src))) return { done: false };
  const dir = await join(await appDataDir(), 'backups');
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  const dest = await join(dir, backupFileName());
  await copyFile(src, dest);
  // Keep only the last 14 dated backups.
  const entries = await readDir(dir);
  const files: { name: string; mtimeMs?: number }[] = [];
  for (const e of entries) {
    if (e.name.endsWith('.db')) files.push({ name: e.name, mtimeMs: (await stat(await join(dir, e.name))).mtime?.getTime?.() });
  }
  const { remove: stale } = selectKeepLast(files, 14);
  for (const f of stale) await remove(await join(dir, f.name)).catch(() => {});
  // Extra folder (USB) if configured and it exists.
  if (settings.backupFolder && (await exists(settings.backupFolder))) {
    await copyFile(src, await join(settings.backupFolder, backupFileName())).catch(() => {});
  }
  await setSetting(await getAppDb(), 'last_auto_backup_at', new Date().toISOString());
  return { done: true, path: dest };
}

// Lazy import to avoid loading the DB connection at module scope.
async function getAppDb() {
  const { appDb } = await import('@/lib/db');
  return appDb;
}


