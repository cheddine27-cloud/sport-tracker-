// ===== Settings service (key/value table `settings`) =====

import type { DbAdapter } from '@/services/dbAdapter';

export interface ShopSettings {
  shopName: string;
  currency: string;
  shopPhone: string;
  shopAddress: string;
  invoiceFooter: string;
  lastAutoBackupAt: string; // ISO datetime or '' when never
  backupFolder: string;     // extra folder for automatic backups ('' = none)
}

const DEFAULTS: ShopSettings = {
  shopName: 'المحل الرياضي',
  currency: 'دج',
  shopPhone: '',
  shopAddress: '',
  invoiceFooter: 'شكرا لتعاملكم معنا',
  lastAutoBackupAt: '',
  backupFolder: '',
};

export const KEYS: Record<keyof ShopSettings, string> = {
  shopName: 'shop_name',
  currency: 'currency',
  shopPhone: 'shop_phone',
  shopAddress: 'shop_address',
  invoiceFooter: 'invoice_footer',
  lastAutoBackupAt: 'last_auto_backup_at',
  backupFolder: 'backup_folder',
};

export async function getSettings(db: DbAdapter): Promise<ShopSettings> {
  const rows = await db.query<{ key: string; value: string }>('SELECT key, value FROM settings');
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULTS };
  for (const k of Object.keys(KEYS) as (keyof ShopSettings)[]) {
    const v = map.get(KEYS[k]);
    if (v != null) out[k] = v;
  }
  return out;
}

export interface SettingsInput {
  shopName: string;
  currency: string;
  shopPhone?: string | null;
  shopAddress?: string | null;
  invoiceFooter?: string | null;
}

export async function updateSettings(db: DbAdapter, input: SettingsInput): Promise<ShopSettings> {
  const name = (input.shopName ?? '').trim();
  if (!name) throw new Error('اسم المحل مطلوب');
  const currency = (input.currency ?? '').trim();
  if (!currency) throw new Error('رمز العملة مطلوب');
  const fields: [string, string][] = [
    [KEYS.shopName, name],
    [KEYS.currency, currency],
    [KEYS.shopPhone, (input.shopPhone ?? '').trim()],
    [KEYS.shopAddress, (input.shopAddress ?? '').trim()],
    [KEYS.invoiceFooter, (input.invoiceFooter ?? '').trim()],
  ];
  await db.transaction(async (tx) => {
    for (const [k, v] of fields) {
      await tx.execute('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v]);
    }
  });
  return getSettings(db);
}

/** Set a single raw key (used for last_auto_backup_at / backup_folder). */
export async function setSetting(db: DbAdapter, key: string, value: string): Promise<void> {
  await db.execute('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}
