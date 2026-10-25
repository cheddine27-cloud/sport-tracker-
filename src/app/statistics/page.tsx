'use client';

// ===== Statistics page: charts (Recharts) + tables, RTL friendly =====

import { startTransition, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip,
  CartesianGrid, Legend, PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { appDb } from '@/lib/db';
import { formatMoney } from '@/lib/format';
import {
  getChannelSummary, getSalesTimeSeries, getTopProducts, getCategoryBreakdown,
  getSlowMovingProducts, getStockAlerts,
  type ChannelSummary, type TimeSeriesPoint, type TopProductRow,
  type CategoryBreakdownRow, type SlowMovingRow,
} from '@/services/statistics';
import type { ProductFinancialRow } from '@/services/expenses';

type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodRange(p: PeriodKey, customFrom: string, customTo: string): { dateFrom: string | null; dateTo: string | null } {
  const now = new Date();
  if (p === 'today') return { dateFrom: iso(now), dateTo: iso(now) };
  if (p === 'week') {
    const start = new Date(now);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { dateFrom: iso(start), dateTo: iso(now) };
  }
  if (p === 'month') return { dateFrom: iso(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: iso(now) };
  if (p === 'year') return { dateFrom: `${now.getFullYear()}-01-01`, dateTo: iso(now) };
  if (p === 'custom') return { dateFrom: customFrom || null, dateTo: customTo || null };
  return { dateFrom: null, dateTo: null };
}

const PERIOD_TABS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'year', label: 'هذه السنة' },
  { key: 'all', label: 'الكل' },
  { key: 'custom', label: 'مخصص' },
];

const PIE_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2'];

function StatsInner() {
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState<PeriodKey>('month');
  // Read the ?period= param without setting state during render (static export + Suspense).
  useEffect(() => {
    const p = searchParams.get('period') as PeriodKey | null;
    if (p && PERIOD_TABS.some((t) => t.key === p)) startTransition(() => setPeriod(p));
  }, [searchParams]);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [topBy, setTopBy] = useState<'units' | 'profit'>('units');
  const [summary, setSummary] = useState<ChannelSummary | null>(null);
  const [series, setSeries] = useState<TimeSeriesPoint[]>([]);
  const [top, setTop] = useState<TopProductRow[]>([]);
  const [breakdown, setBreakdown] = useState<CategoryBreakdownRow[]>([]);
  const [slow, setSlow] = useState<SlowMovingRow[]>([]);
  const [alerts, setAlerts] = useState<ProductFinancialRow[]>([]);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => periodRange(period, customFrom, customTo), [period, customFrom, customTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f = { dateFrom: range.dateFrom, dateTo: range.dateTo };
      // For the time series we need a bounded window; default to last 30 days when "all".
      const now = new Date();
      const from = range.dateFrom ?? iso(new Date(now.getTime() - 29 * 864e5));
      const to = range.dateTo ?? iso(now);
      const g: 'day' | 'week' | 'month' =
        granularity !== 'day' ? granularity : (Number(new Date(to).getTime()) - Number(new Date(from).getTime())) / 864e5 > 90 ? 'month' : 'day';
      const [sum, ts, tops, bd, sl, al] = await Promise.all([
        getChannelSummary(appDb, f),
        getSalesTimeSeries(appDb, { dateFrom: from, dateTo: to, granularity: g }),
        getTopProducts(appDb, { ...f, by: topBy, limit: 5 }),
        getCategoryBreakdown(appDb, f),
        getSlowMovingProducts(appDb, { days: 30 }),
        getStockAlerts(appDb),
      ]);
      setSummary(sum); setSeries(ts); setTop(tops); setBreakdown(bd); setSlow(sl); setAlerts(al);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [range, granularity, topBy]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const cards = [
    { label: 'مجموع البيع في المحل', value: summary?.store.revenue },
    { label: 'مجموع البيع خارج المحل', value: summary?.outside.revenue },
    { label: 'إجمالي المبيعات', value: summary?.combined.revenue },
    { label: 'المصاريف', value: summary != null ? summary.combined.cost + summary.extraExpenses : undefined },
    { label: 'صافي الربح', value: summary?.netProfit },
    { label: 'طلبات قيد الانتظار', value: summary?.pendingExpectedRevenue, sub: summary ? `${summary.pendingCount} طلب` : undefined },
  ];

  return (
    <>
      <PageHeader title="الإحصائيات" description="رسوم بيانية وجداول للمبيعات والأرباح" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PERIOD_TABS.map((p) => (
          <Button key={p.key} size="sm" variant={period === p.key ? 'default' : 'outline'} onClick={() => setPeriod(p.key)}>{p.label}</Button>
        ))}
        {period === 'custom' && (
          <div className="ms-2 flex items-center gap-2">
            <input type="date" className="h-9 rounded-md border bg-background px-3 text-sm" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span>إلى</span>
            <input type="date" className="h-9 rounded-md border bg-background px-3 text-sm" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
        <select className="h-9 ms-auto rounded-md border bg-background px-3 text-sm pe-3 ps-3" value={granularity} onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')}>
          <option value="day">يومي</option>
          <option value="week">أسبوعي</option>
          <option value="month">شهري</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="me-2 h-5 w-5 animate-spin" /> جار التحميل…</div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {cards.map((c) => (
              <Card key={c.label}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="mt-1 text-lg font-bold">{c.value != null ? formatMoney(c.value) : '—'}</p>
                  {c.sub && <p className="text-xs text-muted-foreground">{c.sub}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 font-semibold">المبيعات عبر الزمن (محل مقابل صادرات)</h3>
                {series.length === 0 ? <p className="py-8 text-center text-muted-foreground">لا توجد بيانات في هذه الفترة.</p> : (
                  <div dir="ltr" className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={series}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <RTooltip formatter={(v, name) => [formatMoney(Number(v)), String(name) === 'storeRevenue' ? 'المحل' : 'الصادرات']} />
                        <Legend formatter={(v) => (String(v) === 'storeRevenue' ? 'المحل' : String(v) === 'outsideRevenue' ? 'الصادرات' : String(v))} />
                        <Line type="monotone" dataKey="storeRevenue" stroke="#2563eb" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="outsideRevenue" stroke="#16a34a" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 font-semibold">الإيرادات حسب القسم</h3>
                {breakdown.every((b) => b.revenue === 0) ? <p className="py-8 text-center text-muted-foreground">لا توجد مبيعات في هذه الفترة.</p> : (
                  <div dir="ltr" className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={breakdown.filter((b) => b.revenue > 0)} dataKey="revenue" nameKey="category_name" outerRadius={90} label>
                          {breakdown.filter((b) => b.revenue > 0).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <RTooltip formatter={(v) => formatMoney(Number(v))} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">أفضل 5 منتجات</h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant={topBy === 'units' ? 'default' : 'outline'} onClick={() => setTopBy('units')}>حسب الكمية</Button>
                    <Button size="sm" variant={topBy === 'profit' ? 'default' : 'outline'} onClick={() => setTopBy('profit')}>حسب الربح</Button>
                  </div>
                </div>
                {top.length === 0 ? <p className="py-8 text-center text-muted-foreground">لا توجد مبيعات مؤكدة في هذه الفترة.</p> : (
                  <div dir="ltr" className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={top} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                        <RTooltip formatter={(v) => formatMoney(Number(v))} />
                        <Bar dataKey={topBy === 'units' ? 'unitsSold' : 'profit'} fill="#7c3aed" radius={4} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 font-semibold">أكثر المنتجات مبيعا</h3>
                {top.length === 0 ? <p className="text-muted-foreground">لا توجد مبيعات.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>كمية</TableHead><TableHead>ربح</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {top.map((t) => (
                        <TableRow key={t.product_id}><TableCell>{t.name}</TableCell><TableCell>{t.unitsSold}</TableCell><TableCell>{formatMoney(t.profit)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 font-semibold">منتجات راكدة (30 يوما)</h3>
                {slow.length === 0 ? <p className="text-muted-foreground">لا توجد منتجات راكدة. 👍</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>الكمية</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {slow.slice(0, 8).map((s) => <TableRow key={s.product_id}><TableCell>{s.name}</TableCell><TableCell>{s.quantity}</TableCell></TableRow>)}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 font-semibold">تنبيهات المخزون</h3>
                {alerts.length === 0 ? <p className="text-muted-foreground">كل الكميات بحالة جيدة.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {alerts.slice(0, 8).map((a) => (
                        <TableRow key={a.product_id}>
                          <TableCell>{a.name}</TableCell>
                          <TableCell>{a.quantity <= 0 ? <Badge className="bg-red-100 text-red-800">نفد</Badge> : <Badge className="bg-orange-100 text-orange-800">قارب على النفاد ({a.quantity})</Badge>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

export default function StatisticsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="me-2 h-5 w-5 animate-spin" /></div>}>
      <StatsInner />
    </Suspense>
  );
}
