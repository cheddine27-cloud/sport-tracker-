// Browser-safe fallback for dialog
export async function save(options?: unknown): Promise<string | null> {
  if (typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      return await dialog.save(options as Parameters<typeof dialog.save>[0]);
    } catch (e) {
      console.warn('Tauri save dialog fallback:', e);
    }
  }
  return 'backup-browser-store.db';
}

export async function open(options?: unknown): Promise<string | string[] | null> {
  if (typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      return await dialog.open(options as Parameters<typeof dialog.open>[0]);
    } catch (e) {
      console.warn('Tauri open dialog fallback:', e);
    }
  }
  return null;
}
