// Browser-safe fallback for opener
export async function openUrl(url: string): Promise<void> {
  if (typeof window !== 'undefined') {
    if ('__TAURI__' in window || '__TAURI_INTERNALS__' in window) {
      try {
        const { openUrl: tauriOpen } = await import('@tauri-apps/plugin-opener');
        await tauriOpen(url);
        return;
      } catch (e) {
        console.warn('Tauri opener failed, using window.open:', e);
      }
    }
    window.open(url, '_blank');
  }
}
