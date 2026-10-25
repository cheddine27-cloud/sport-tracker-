'use client';

// ===== Dashboard: today's KPIs, 7-day chart, last sales, low stock, quick actions =====

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { appDb } from '@/lib/db';
import { getChannelSummary, getSalesTimeSeries } from '@/services/statistics';
import { getInventorySummary, getLowStockProducts } from '@/services/stock';
import { getSales, type SaleWithItems } from '@/services/sales';
import { formatMoney, formatDateShort } from '@/lib/format';
import { SALE_STATUS_LABELS as STATUS_LABELS } from '@/lib/labels';
import { runAutoBackupIfNeeded } from '@/lib/backupOps';
import { ShoppingCart, PackagePlus, Plus, AlertTriangle, TrendingUp, Wallet, Boxes, Clock } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getChannelSummary>> | null>(null);
  const [inv, setInv] = useState<Awaited<ReturnType<typeof getInventorySummary>> | null>(null);
  const [series, setSeries] = useState<{ period: string; storeRevenue: number; outsideRevenue: number }[]>([]);
  const [lastSales, setLastSales] = useState<SaleWithItems[]>([]);
  const [lowStock, setLowStock] = useState<Awaited<ReturnType<typeof getLowStockProducts>>>([]);

  const load = useCallback(async () => {
    try {
      const day = todayStr();
      const [s, i, ser, sales, alerts] = await Promise.all([
        getChannelSummary(appDb, { dateFrom: day, dateTo: day }),
        getInventorySummary(appDb),
        getSalesTimeSeries(appDb, { dateFrom: (() => { const d = new Date(); d.setDate(d.getDate() - 6); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(), dateTo: day, granularity: 'day' }),
        getSales(appDb, { limit: 5 }),
        getLowStockProducts(appDb),
      ]);
      setSummary(s);
      setInv(i);
      setSeries(ser.map((p) => ({ period: p.period.slice(5), storeRevenue: p.storeRevenue, outsideRevenue: p.outsideRevenue })));
      setLastSales(sales);
      setLowStock(alerts);
    } catch (e) {
      toast.error(`تعذر تحميل لوحة التحكم: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      await load();
      // Automatic backup on start if older than 24h (silent unless it runs).
      try {
        const r = await runAutoBackupIfNeeded();
        if (r.done) toast.success('تم إنشاء نسخة احتياطية تلقائية');
      } catch { /* offline/dev without Tauri fs: ignore */ }
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const cards = [
    { label: 'مبيعات اليوم', value: summary ? formatMoney(summary.combined.revenue) : '…', icon: Wallet, color: 'text-green-700' },
    { label: 'ربح اليوم', value: summary ? formatMoney(summary.combined.profit) : '…', icon: TrendingUp, color: 'text-blue-700' },
    { label: 'قيمة المخزون', value: inv ? formatMoney(inv.stockValueAtCost) : '…', icon: Boxes, color: 'text-amber-700' },
    { label: 'طلبات قيد الانتظار', value: summary ? String(summary.pendingCount) : '…', icon: Clock, color: 'text-yellow-600' },
    { label: 'قاربت على النفاد', value: inv ? String(inv.lowStockCount) : '…', icon: AlertTriangle, color: 'text-orange-600' },
    { label: 'نفدت من المخزون', value: inv ? String(inv.outOfStockCount) : '…', icon: AlertTriangle, color: 'text-red-600' },
  ];

  return (
    <>
      <PageHeader title="لوحة التحكم" description="نظرة عامة على نشاط المحل اليوم" />

      {/* Quick actions */}
      <div className="mb-6 flex flex-wrap gap-3">
        <Button asChild><Link href="/pos"><ShoppingCart className="me-2 size-4" /> بيع جديد</Link></Button>
        <Button asChild variant="outline"><Link href="/exports"><PackagePlus className="me-2 size-4" /> طلب جديد</Link></Button>
        <Button asChild variant="outline"><Link href="/products"><Plus className="me-2 size-4" /> إضافة منتج</Link></Button>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-6">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-5">
              <div className={`flex items-center gap-2 text-sm text-muted-foreground`}><c.icon className={`size-4 ${c.color}`} /> {c.label}</div>
              <div className="mt-2 text-xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 7-day chart */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">المبيعات خلال 7 أيام</CardTitle></CardHeader>
          <CardContent className="h-72">
            {series.length === 0 || series.every((s) => s.storeRevenue + s.outsideRevenue === 0) ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">لا توجد مبيعات في الأيام الأخيرة</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" fontSize={12} reversed />
                  <YAxis fontSize={12} orientation="right" width={70} tickFormatter={(v: number) => v.toLocaleString('en-US')} />
                  <Tooltip formatter={(v) => formatMoney(Number(v))} />
                  <Legend />
                  <Bar dataKey="storeRevenue" name="البيع في المحل" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  <Line dataKey="outsideRevenue" name="الصادرات" stroke="#2563eb" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Last sales */}
        <Card>
          <CardHeader><CardTitle className="text-base">آخر المبيعات</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {lastSales.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">لا توجد مبيعات بعد. ابدأ من صفحة البيع في المحل.</p>
            ) : (
              lastSales.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <div>
                    <div className="font-semibold">فاتورة #{s.id} — {s.type === 'store' ? 'المحل' : 'تصدير'}</div>
                    <div className="text-xs text-muted-foreground">{formatDateShort(s.created_at)} · {s.items?.length ?? 0} منتج{s.customer_name ? ` · ${s.customer_name}` : ''}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-bold">{formatMoney(s.total)}</div>
                    <Badge variant={s.status === 'confirmed' ? 'default' : s.status === 'pending' ? 'secondary' : 'destructive'} className="mt-1">{STATUS_LABELS[s.status]}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Low stock list */}
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">منتجات تحتاج تزويدا</CardTitle></CardHeader>
        <CardContent>
          {lowStock.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">كل الكميات ضمن الحدود الآمنة ✅</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {lowStock.slice(0, 9).map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.sku} · المتبقي: {p.quantity}</div>
                  </div>
                  <Badge variant={p.status === 'out' ? 'destructive' : 'secondary'} className={p.status === 'out' ? '' : 'bg-orange-100 text-orange-800 hover:bg-orange-100'}>
                    {p.status === 'out' ? 'نفد' : 'قارب على النفاد'}
                  </Badge>
                  <Button size="sm" variant="outline" asChild><Link href={`/inventory?restock=${p.id}`}>تزويد</Link></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
