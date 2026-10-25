'use client';

// ===== Distributors page: contacts + WhatsApp shortcuts =====

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MessageCircle, Pencil, Plus, Search, Trash2, Loader2 } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { appDb } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { whatsappUrl } from '@/lib/phone';
import { WHATSAPP_MESSAGE_TEMPLATES } from '@/lib/labels';
import {
  getDistributors, addDistributor, updateDistributor, deleteDistributor,
} from '@/services/distributors';
import type { Distributor } from '@/types';

interface FormState { name: string; whatsapp: string; note: string; }
const EMPTY_FORM: FormState = { name: '', whatsapp: '', note: '' };

export default function DistributorsPage() {
  const [rows, setRows] = useState<Distributor[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Distributor | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Distributor | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getDistributors(appDb, { search: search.trim() || null }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحميل الموزعين');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const openAdd = () => { setEditing(null); setForm(EMPTY_FORM); setFormOpen(true); };
  const openEdit = (d: Distributor) => {
    setEditing(d);
    setForm({ name: d.name, whatsapp: d.display ?? d.whatsapp, note: d.note ?? '' });
    setFormOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        await updateDistributor(appDb, editing.id, form);
        toast.success('تم تحديث بيانات الموزع.');
      } else {
        await addDistributor(appDb, form);
        toast.success('تمت إضافة الموزع.');
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteDistributor(appDb, deleteTarget.id);
      toast.success(`تم حذف الموزع "${deleteTarget.name}".`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحذف');
    } finally {
      setBusy(false);
    }
  };

  const openWhatsApp = async (d: Distributor, message?: string) => {
    const url = whatsappUrl(d.whatsapp, message);
    if (!url) { toast.error('رقم واتساب غير صالح لهذا الموزع.'); return; }
    try {
      await openUrl(url);
    } catch {
      toast.error('تعذر فتح واتساب. تأكد من اتصال الإنترنت وتثبيت واتساب');
    }
  };

  return (
    <>
      <PageHeader title="الموزعون" description="قائمة الموزعين مع اختصار واتساب">
        <Button onClick={openAdd}>
          <Plus className="ms-2 h-4 w-4" />
          إضافة موزع
        </Button>
      </PageHeader>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="بحث بالاسم أو الرقم أو ملاحظة..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pe-9"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {search.trim() ? 'لا توجد نتائج مطابقة للبحث.' : 'لا يوجد موزعون بعد. اضغط "إضافة موزع" للبدء.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((d) => (
            <Card key={d.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{d.name}</h3>
                    <p dir="ltr" className="mt-1 text-start text-sm text-muted-foreground">{d.display ?? d.whatsapp}</p>
                    {d.note && <p className="mt-2 text-sm text-muted-foreground">{d.note}</p>}
                    {d.created_at && (
                      <p className="mt-2 text-xs text-muted-foreground">أضيف يوم {formatDate(d.created_at)}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(d)} aria-label="تعديل">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(d)} aria-label="حذف">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Button className="bg-green-600 text-white hover:bg-green-700" onClick={() => void openWhatsApp(d)}>
                    <MessageCircle className="ms-2 h-4 w-4" />
                    واتساب
                  </Button>
                  <Select onValueChange={(v) => {
                    const tpl = WHATSAPP_MESSAGE_TEMPLATES.find((t) => t.key === v);
                    if (tpl) void openWhatsApp(d, tpl.message);
                  }}>
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="رسالة جاهزة" />
                    </SelectTrigger>
                    <SelectContent>
                      {WHATSAPP_MESSAGE_TEMPLATES.map((t) => (
                        <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل موزع' : 'إضافة موزع'}</DialogTitle>
            <DialogDescription>الاسم ورقم واتساب مطلوبان.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="dist-name">الاسم</Label>
              <Input id="dist-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="dist-phone">رقم واتساب</Label>
              <Input id="dist-phone" dir="ltr" className="text-start"
                placeholder="0555123456 او +213 555 12 34 56"
                value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="dist-note">ملاحظة (اختياري)</Label>
              <Input id="dist-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>إلغاء</Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تأكيد الحذف</DialogTitle>
            <DialogDescription>
              {'هل تريد حذف الموزع "'}{deleteTarget?.name}{'"؟ لا يمكن التراجع عن هذا الإجراء.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={() => void doDelete()} disabled={busy}>
              {busy && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
              حذف نهائي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
