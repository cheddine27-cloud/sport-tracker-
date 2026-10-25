'use client';

// ===== Settings page: shop info, backup/restore, integrity check =====

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { appDb } from '@/lib/db';
import { getSettings, updateSettings, setSetting, type ShopSettings } from '@/services/settings';
import { manualBackupTo, restoreFrom, runAutoBackupIfNeeded } from '@/lib/backupOps';
import { verifyStockIntegrity } from '@/services/stock';
import { formatDate } from '@/lib/format';
import { save, open } from '@tauri-apps/plugin-dialog';
import { DatabaseBackup } from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await getSettings(appDb));
    } catch (e) {
      toast.error(`تعذر تحميل الإعدادات: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!settings) {
    return (
      <>
        <PageHeader title="الإعدادات" description="إعدادات المحل، النسخ الاحتياطي وسلامة البيانات" />
        <Card><CardContent className="py-10 text-center text-muted-foreground">جاري التحميل…</CardContent></Card>
      </>
    );
  }

  async function saveInfo() {
    if (!settings) return;
    setSaving(true);
    try {
      const form = settings;
      const updated = await updateSettings(appDb, {
        shopName: form.shopName,
        currency: form.currency,
        shopPhone: form.shopPhone,
        shopAddress: form.shopAddress,
        invoiceFooter: form.invoiceFooter,
      });
      setSettings(updated);
      toast.success('تم حفظ معلومات المحل');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function backupNow() {
    setBusy('backup');
    try {
      const dest = await save({
        defaultPath: `sports-store-backup-${new Date().toISOString().slice(0, 10)}.db`,
        filters: [{ name: 'قاعدة بيانات SQLite', extensions: ['db'] }],
      });
      if (!dest) return;
      const path = await manualBackupTo(dest);
      toast.success(`تم إنشاء النسخة الاحتياطية في: ${path}`);
    } catch (e) {
      toast.error(`فشل النسخ الاحتياطي: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function doRestore(path: string) {
    setBusy('restore');
    try {
      await restoreFrom(path);
      toast.success('تمت الاستعادة. أعد تشغيل التطبيق لتحميل البيانات الجديدة', { duration: 10000 });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setRestoreOpen(false);
    }
  }

  async function pickRestoreFile() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'قاعدة بيانات SQLite', extensions: ['db'] }],
    });
    if (typeof path === 'string') await doRestore(path);
  }

  async function autoBackupNow() {
    setBusy('auto');
    try {
      const r = await runAutoBackupIfNeeded();
      if (r.done) {
        await load();
        toast.success(`تم نسخ احتياطي تلقائي: ${r.path}`);
      } else {
        toast.info('النسخ التلقائي حديث (أقل من 24 ساعة) أو لا توجد قاعدة بيانات بعد');
      }
    } catch (e) {
      toast.error(`فشل النسخ التلقائي: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function pickExtraFolder() {
    const dir = await open({ directory: true });
    if (typeof dir === 'string') {
      await setSetting(appDb, 'backup_folder', dir);
      await load();
      toast.success('تم حفظ مجلد النسخ الإضافي');
    }
  }

  async function checkIntegrity() {
    setBusy('integrity');
    try {
      const bad = await verifyStockIntegrity(appDb);
      if (bad.length === 0) toast.success('فحص سلامة المخزون: سليم، الكميات مطابقة لسجل الحركات');
      else toast.error(`الفحص وجد ${bad.length} منتجاً بكميات غير متطابقة مع سجل الحركات`);
    } catch (e) {
      toast.error(`فشل الفحص: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="الإعدادات" description="إعدادات المحل، النسخ الاحتياطي وسلامة البيانات" />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Shop info */}
        <Card>
          <CardHeader><CardTitle className="text-base">معلومات المحل</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="shopName">اسم المحل *</Label>
              <Input id="shopName" value={settings.shopName} onChange={(e) => setSettings({ ...settings, shopName: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">هاتف المحل</Label>
                <Input id="phone" value={settings.shopPhone} onChange={(e) => setSettings({ ...settings, shopPhone: e.target.value })} placeholder="0555…" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">رمز العملة</Label>
                <Input id="currency" value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">عنوان المحل</Label>
              <Input id="address" value={settings.shopAddress} onChange={(e) => setSettings({ ...settings, shopAddress: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="footer">نص أسفل الفاتورة</Label>
              <textarea id="footer" rows={2} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" value={settings.invoiceFooter} onChange={(e) => setSettings({ ...settings, invoiceFooter: e.target.value })} />
            </div>
            <Button onClick={saveInfo} disabled={saving}>{saving ? 'جاري الحفظ…' : 'حفظ المعلومات'}</Button>
          </CardContent>
        </Card>

        {/* Backup & restore */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><DatabaseBackup className="size-4" /> النسخ الاحتياطي والاستعادة</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              آخر نسخة تلقائية: {settings.lastAutoBackupAt ? formatDate(settings.lastAutoBackupAt) : 'لم تُنشأ بعد'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={backupNow} disabled={busy !== null}>نسخة احتياطية الآن</Button>
              <Button variant="outline" onClick={autoBackupNow} disabled={busy !== null}>نسخ تلقائي الآن</Button>
              <Button variant="destructive" onClick={() => setRestoreOpen(true)} disabled={busy !== null}>استعادة نسخة</Button>
            </div>
            <div className="space-y-2 pt-2 border-t">
              <Label>مجلد إضافي للنسخ التلقائي (مثل مفتاح USB)</Label>
              <div className="flex gap-2">
                <Input readOnly value={settings.backupFolder || 'غير محدد'} className="text-xs" />
                <Button size="sm" variant="secondary" onClick={pickExtraFolder}>اختيار</Button>
              </div>
              <p className="text-xs text-muted-foreground">تُحفظ النسخ التلقائية أيضا في مجلد backups داخل بيانات التطبيق (آخر 14 نسخة).</p>
            </div>
            <div className="pt-2 border-t">
              <Button variant="outline" onClick={checkIntegrity} disabled={busy !== null}>فحص سلامة المخزون</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Restore confirmation */}
      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>تأكيد الاستعادة</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm font-semibold text-red-600">تحذير: سيتم استبدال كل البيانات الحالية ببيانات النسخة المختارة.</p>
            <p className="text-sm text-muted-foreground">سيتم أولا أخذ نسخة أمان تلقائية من القاعدة الحالية. اختر ملف النسخة الاحتياطية (.db):</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRestoreOpen(false)}>إلغاء</Button>
            <Button variant="destructive" onClick={pickRestoreFile} disabled={busy !== null}>اختيار الملف واستعادة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
