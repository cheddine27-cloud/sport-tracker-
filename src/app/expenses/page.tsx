'use client';

// ===== Expenses page: per-product financials + extra expenses =====

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { appDb } from '@/lib/db';
import { formatMoney } from '@/lib/format';
import { getCategories } from '@/services/categories';
import {
  getProductFinancials, getFinancialSummary, addExpense, updateExpense,
  deleteExpense, getExpenses,
  type ProductFinancialRow, type FinancialSummary,
} from '@/services/expenses';
import type { Category, Expense } from '@/types';

type PeriodKey = 'today' | 'week' | 'month' | 'custom' | 'all';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodRange(p: PeriodKey, customFrom: string, customTo: string): { dateFrom?: string | null; dateTo?: string | null } {
  const now = new Date();
  if (p === 'today') return { dateFrom: iso(now), dateTo: iso(now) };
  if (p === 'week') {
    const start = new Date(now);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
    return { dateFrom: iso(start), dateTo: iso(now) };
  }
  if (p === 'month') return { dateFrom: iso(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: iso(now) };
  if (p === 'custom') return { dateFrom: customFrom || null, dateTo: customTo || null };
  return {};
}

const PERIOD_TABS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'all', label: 'الكل' },
  { key: 'custom', label: 'مخصص' },
];

export default function ExpensesPage() {
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [tab, setTab] = useState<'products' | 'expenses'>('products');
  const [rows, setRows] = useState<ProductFinancialRow[]>([]);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [editTarget, setEditTarget] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [busy, setBusy] = useState(false);

  const range = useMemo(() => periodRange(period, customFrom, customTo), [period, customFrom, customTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f = range;
      const [fin, sum, exps, cats] = await Promise.all([
        getProductFinancials(appDb, { ...f, search: search.trim() || null, categoryId }),
        getFinancialSummary(appDb, f),
        getExpenses(appDb, f),
        getCategories(appDb),
      ]);
      setRows(fin);
      setSummary(sum);
      setExpenses(exps);
      setCategories(cats);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [range, search, categoryId]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  async function saveExpense() {
    setBusy(true);
    try {
      if (editTarget) {
        await updateExpense(appDb, editTarget.id, { description: desc.trim(), amount: Number(amount) });
        toast.success('تم تعديل المصروف');
      } else {
        await addExpense(appDb, { description: desc.trim(), amount: Number(amount) });
        toast.success('تمت إضافة المصروف');
      }
      setEditTarget(null); setDesc(''); setAmount('');
      await load();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally { setBusy(false); }
  }

  async function doDeleteExpense() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteExpense(appDb, deleteTarget.id);
      toast.success('تم حذف المصروف');
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally { setBusy(false); }
  }

  const totals = useMemo(() => ({
    stockCost: rows.reduce((s, r) => s + r.stockCost, 0),
    soldUnits: rows.reduce((s, r) => s + r.soldUnits, 0),
    revenue: rows.reduce((s, r) => s + r.soldRevenue, 0),
    cost: rows.reduce((s, r) => s + r.soldCost, 0),
    profit: rows.reduce((s, r) => s + r.profit, 0),
  }), [rows]);

  return (
    <>
      <PageHeader title="المصاريف والأرباح" description="متابعة أرباح كل منتج والمصاريف الإضافية" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PERIOD_TABS.map((p) => (
          <Button key={p.key} size="sm" variant={period === p.key ? 'default' : 'outline'} onClick={() => setPeriod(p.key)}>
            {p.label}
          </Button>
        ))}
        {period === 'custom' && (
          <div className="ms-2 flex items-center gap-2">
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-40" />
            <span>إلى</span>
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-40" />
          </div>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: 'تكلفة المخزون الحالي', value: summary?.totalStockCost },
          { label: 'إجمالي المبيعات', value: summary?.totalRevenue },
          { label: 'تكلفة المبيعات', value: summary?.totalCost },
          { label: 'الربح الإجمالي', value: summary?.grossProfit },
          { label: 'المصاريف الإضافية', value: summary?.extraExpenses },
          { label: 'صافي الربح', value: summary?.netProfit },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="mt-1 text-lg font-bold">{c.value != null ? formatMoney(c.value) : '—'}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={tab === 'products' ? 'default' : 'outline'} onClick={() => setTab('products')}>حسب المنتج</Button>
        <Button size="sm" variant={tab === 'expenses' ? 'default' : 'outline'} onClick={() => setTab('expenses')}>مصاريف إضافية</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="me-2 h-5 w-5 animate-spin" /> جار التحميل…</div>
      ) : tab === 'products' ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input placeholder="بحث بالاسم أو المعرف أو اللون…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm pe-3 ps-3"
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">كل الأقسام</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {rows.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد بيانات مطابقة للفترة المختارة.</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المنتج</TableHead>
                      <TableHead>القسم</TableHead>
                      <TableHead>الكمية الباقية</TableHead>
                      <TableHead>سعر الشراء</TableHead>
                      <TableHead>تكلفة المخزون الباقي</TableHead>
                      <TableHead>الوحدات المباعة</TableHead>
                      <TableHead>المبيعات</TableHead>
                      <TableHead>التكلفة</TableHead>
                      <TableHead>الربح</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.product_id}>
                        <TableCell className="font-medium">{r.name}<div className="text-xs text-muted-foreground">{r.sku}</div></TableCell>
                        <TableCell>{r.category_name}</TableCell>
                        <TableCell>{r.quantity}{r.pendingUnits > 0 && <Badge variant="outline" className="ms-2 text-xs">+{r.pendingUnits} قيد الانتظار</Badge>}</TableCell>
                        <TableCell>{formatMoney(r.purchase_price)}</TableCell>
                        <TableCell>{formatMoney(r.stockCost)}</TableCell>
                        <TableCell>{r.soldUnits}</TableCell>
                        <TableCell>{formatMoney(r.soldRevenue)}</TableCell>
                        <TableCell>{formatMoney(r.soldCost)}</TableCell>
                        <TableCell className={r.profit >= 0 ? 'font-semibold text-green-700' : 'font-semibold text-red-600'}>
                          {formatMoney(r.profit)}
                          {r.pendingExpectedProfit > 0 && <div className="text-xs text-muted-foreground">متوقع: {formatMoney(r.pendingExpectedProfit)}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/60 font-bold">
                      <TableCell colSpan={4}>الإجمالي</TableCell>
                      <TableCell>{formatMoney(totals.stockCost)}</TableCell>
                      <TableCell>{totals.soldUnits}</TableCell>
                      <TableCell>{formatMoney(totals.revenue)}</TableCell>
                      <TableCell>{formatMoney(totals.cost)}</TableCell>
                      <TableCell>{formatMoney(totals.profit)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <>
          <Card className="mb-4">
            <CardContent className="flex flex-wrap items-end gap-3 p-4">
              <div className="min-w-48 flex-1">
                <Label>الوصف</Label>
                <Input placeholder="مثال: كراء، نقل، كهرباء…" value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
              <div className="w-40">
                <Label>المبلغ (دج)</Label>
                <Input type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <Button onClick={saveExpense} disabled={busy}>
                {editTarget ? <Pencil className="me-2 h-4 w-4" /> : <Plus className="me-2 h-4 w-4" />}
                {editTarget ? 'حفظ التعديل' : 'إضافة مصروف'}
              </Button>
              {editTarget && (
                <Button variant="outline" onClick={() => { setEditTarget(null); setDesc(''); setAmount(''); }}>إلغاء</Button>
              )}
            </CardContent>
          </Card>
          {expenses.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد مصاريف في هذه الفترة.</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>الوصف</TableHead><TableHead>المبلغ</TableHead><TableHead>التاريخ</TableHead><TableHead>إجراءات</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.description}</TableCell>
                        <TableCell>{formatMoney(e.amount)}</TableCell>
                        <TableCell className="text-muted-foreground">{e.created_at}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => { setEditTarget(e); setDesc(e.description); setAmount(String(e.amount)); }}><Pencil className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(e)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/60 font-bold">
                      <TableCell>الإجمالي</TableCell>
                      <TableCell>{formatMoney(expenses.reduce((s, e) => s + e.amount, 0))}</TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>حذف المصروف</DialogTitle></DialogHeader>
          <p>هل تريد فعلا حذف المصروف «{deleteTarget?.description}» بمبلغ {deleteTarget ? formatMoney(deleteTarget.amount) : ''}؟</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={doDeleteExpense} disabled={busy}>حذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
