'use client';

// ===== Exports page: outside-store orders (pending / confirmed / cancelled) =====

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { MessageCircle, Loader2 } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { appDb } from '@/lib/db';
import { formatMoney, formatDate } from '@/lib/format';
import { whatsappUrl } from '@/lib/phone';
import { getSettings } from '@/services/settings';
import { buildInvoiceHtml, printInvoice } from '@/lib/invoice';
import { SALE_STATUS_LABELS, SALE_STATUS_BADGE } from '@/lib/labels';
import {
  getSales, getSaleById, confirmOutsideSale, cancelOutsideSale, getSalesSummary,
  type SaleWithItems, type SalesSummary,
} from '@/services/sales';
import { NewOrderDialog } from '@/components/exports/NewOrderDialog';
import type { SaleStatus } from '@/types';

const TABS: { key: SaleStatus; label: string }[] = [
  { key: 'pending', label: 'قيد الانتظار' },
  { key: 'confirmed', label: 'مؤكد' },
  { key: 'cancelled', label: 'ملغي' },
];

async function doPrintInvoice(saleId: number) {
  try {
    const sale = await getSaleById(appDb, saleId);
    if (!sale) { toast.error('تعذر تحميل الفاتورة'); return; }
    const shop = await getSettings(appDb);
    await printInvoice(buildInvoiceHtml(sale, shop));
  } catch (e) {
    toast.error((e as Error).message || 'تعذر الطباعة');
  }
}

function itemsSummary(s: SaleWithItems): string {
  return s.items.map((i) => `${i.product_name} ×${i.quantity}`).join('، ');
}

export default function ExportsPage() {
  const [tab, setTab] = useState<SaleStatus>('pending');
  const [rows, setRows] = useState<SaleWithItems[]>([]);
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [orderOpen, setOrderOpen] = useState(false);
  const [details, setDetails] = useState<SaleWithItems | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<SaleWithItems | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SaleWithItems | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        getSales(appDb, { type: 'outside', status: tab, search: search.trim() || null, limit: 200 }),
        getSalesSummary(appDb, { type: 'outside' }),
      ]);
      setRows(list);
      setSummary(sum);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحميل الطلبات');
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const doConfirm = async () => {
    if (!confirmTarget) return;
    setBusy(true);
    try {
      await confirmOutsideSale(appDb, confirmTarget.id);
      toast.success(`تم تأكيد تسليم الطلب رقم ${confirmTarget.id}`);
      setConfirmTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تأكيد الطلب');
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      await cancelOutsideSale(appDb, cancelTarget.id);
      toast.success(`تم إلغاء الطلب رقم ${cancelTarget.id} وإرجاع الكميات إلى المخزون`);
      setCancelTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إلغاء الطلب');
    } finally {
      setBusy(false);
    }
  };

  const openDetails = async (id: number) => {
    try {
      const s = await getSaleById(appDb, id);
      if (s) setDetails(s);
    } catch {
      toast.error('تعذر تحميل تفاصيل الطلب');
    }
  };

  const openWhatsApp = async (phone: string | null) => {
    const url = whatsappUrl(phone);
    if (!url) {
      toast.error('رقم الهاتف غير صالح للواتساب');
      return;
    }
    try {
      await openUrl(url);
    } catch {
      toast.error('تعذر فتح رابط واتساب');
    }
  };

  return (
    <>
      <PageHeader title="الصادرات" description="طلبات البيع خارج المحل: قيد الانتظار، التأكيد والإلغاء">
        <Button onClick={() => setOrderOpen(true)}>طلب جديد</Button>
      </PageHeader>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-6">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">طلبات قيد الانتظار</p>
          <p className="text-2xl font-bold text-yellow-600">{summary?.pendingCount ?? '-'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">الإيراد المتوقع</p>
          <p className="text-lg font-bold">{summary ? formatMoney(summary.pendingExpectedRevenue) : '-'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">الربح المتوقع</p>
          <p className="text-lg font-bold text-emerald-700">{summary ? formatMoney(summary.pendingExpectedProfit) : '-'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">إجمالي الصادرات المؤكدة</p>
          <p className="text-lg font-bold">{summary ? formatMoney(summary.revenue) : '-'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">أرباح الصادرات المؤكدة</p>
          <p className="text-lg font-bold text-emerald-700">{summary ? formatMoney(summary.profit) : '-'}</p>
        </CardContent></Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
        <div className="ms-auto">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث برقم الطلب أو الزبون..."
            className="w-60"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-8 text-center text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل...
            </p>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">
              لا توجد طلبات {SALE_STATUS_LABELS[tab]} حاليا. أنشئ طلبا جديدا بزر &quot;طلب جديد&quot;.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الطلب</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الزبون</TableHead>
                  <TableHead>الهاتف</TableHead>
                  <TableHead>المنتجات</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الربح</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-end">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id} className={s.status === 'cancelled' ? 'line-through opacity-60' : ''}>
                    <TableCell className="font-medium">#{s.id}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{formatDate(s.created_at)}</TableCell>
                    <TableCell>{s.customer_name ?? '-'}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span dir="ltr" className="text-xs">{s.customer_phone ?? '-'}</span>
                      {s.customer_phone && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-green-600 ms-1"
                          onClick={() => void openWhatsApp(s.customer_phone)}
                          aria-label="مراسلة عبر واتساب"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-xs" title={itemsSummary(s)}>
                      {itemsSummary(s)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatMoney(s.total)}</TableCell>
                    <TableCell className="whitespace-nowrap text-emerald-700">{formatMoney(s.profit)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={SALE_STATUS_BADGE[s.status]}>
                        {SALE_STATUS_LABELS[s.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => void openDetails(s.id)}>تفاصيل</Button>
                      {s.status === 'pending' && (
                        <>
                          <Button size="sm" className="ms-2" onClick={() => setConfirmTarget(s)}>
                            تأكيد التسليم
                          </Button>
                          <Button size="sm" variant="destructive" className="ms-2" onClick={() => setCancelTarget(s)}>
                            إلغاء
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewOrderDialog open={orderOpen} onOpenChange={setOrderOpen} onCreated={() => void load()} />

      {/* Confirm dialog */}
      <Dialog open={!!confirmTarget} onOpenChange={(o) => !o && setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>تأكيد التسليم</DialogTitle></DialogHeader>
          {confirmTarget && (
            <p className="text-sm">
              هل تريد تأكيد تسليم الطلب رقم <b>{confirmTarget.id}</b>؟
              <br />الإجمالي: <b>{formatMoney(confirmTarget.total)}</b> — الربح: <b>{formatMoney(confirmTarget.profit)}</b>
              <br /><span className="text-muted-foreground">لن تتغير الكميات (خُصمت عند إنشاء الطلب)، وسيُحتسب هذا الطلب في الإيراد والأرباح.</span>
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>رجوع</Button>
            <Button onClick={() => void doConfirm()} disabled={busy}>تأكيد التسليم</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>إلغاء الطلب</DialogTitle></DialogHeader>
          {cancelTarget && (
            <p className="text-sm">
              سيتم إلغاء الطلب رقم <b>{cancelTarget.id}</b> ({itemsSummary(cancelTarget)}).
              <br /><span className="text-amber-700">تحذير: ستُرجَع الكميات إلى المخزون ولن يُحتسب هذا الطلب في الإيراد ولا الأرباح.</span>
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>رجوع</Button>
            <Button variant="destructive" onClick={() => void doCancel()} disabled={busy}>إلغاء الطلب</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details dialog (read-only) */}
      <Dialog open={!!details} onOpenChange={(o) => !o && setDetails(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>تفاصيل الطلب #{details?.id}</DialogTitle>
          </DialogHeader>
          {details && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <p><span className="text-muted-foreground">الزبون:</span> {details.customer_name ?? '-'}</p>
                <p><span className="text-muted-foreground">الهاتف:</span> <span dir="ltr">{details.customer_phone ?? '-'}</span></p>
                <p className="col-span-2"><span className="text-muted-foreground">العنوان:</span> {details.customer_address ?? '-'}</p>
                <p><span className="text-muted-foreground">التاريخ:</span> {formatDate(details.created_at)}</p>
                <p><span className="text-muted-foreground">الحالة:</span> {SALE_STATUS_LABELS[details.status]}</p>
                {details.note && <p className="col-span-2"><span className="text-muted-foreground">ملاحظة:</span> {details.note}</p>}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المنتج</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>سعر الوحدة</TableHead>
                    <TableHead>الإجمالي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {details.items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>{it.product_name}</TableCell>
                      <TableCell>{it.quantity}</TableCell>
                      <TableCell>{formatMoney(it.sale_price)}</TableCell>
                      <TableCell>{formatMoney(it.quantity * it.sale_price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="rounded-md bg-muted p-3 space-y-1">
                <div className="flex justify-between"><span>المجموع الفرعي:</span><span>{formatMoney(details.subtotal)}</span></div>
                <div className="flex justify-between"><span>الخصم:</span><span>- {formatMoney(details.discount)}</span></div>
                <div className="flex justify-between font-semibold"><span>الإجمالي:</span><span>{formatMoney(details.total)}</span></div>
                <div className="flex justify-between text-emerald-700"><span>الربح:</span><span>{formatMoney(details.profit)}</span></div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs">
                  <Link href="/inventory" className="text-blue-600 underline">عرض المخزون</Link>
                </p>
                <Button size="sm" variant="outline" onClick={() => void doPrintInvoice(details.id)}>طباعة الفاتورة</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
