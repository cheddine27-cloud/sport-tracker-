// Browser-safe fallback for dialog
export async function save(options?: any): Promise<string | null> {
  if (typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      return await dialog.save(options);
    } catch (e) {
      console.warn('Tauri save dialog fallback:', e);
    }
  }
  return 'backup-browser-store.db';
}

export async function open(options?: any): Promise<string | string[] | null> {
  if (typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      return await dialog.open(options);
    } catch (e) {
      console.warn('Tauri open dialog fallback:', e);
    }
  }
  return null;
}
