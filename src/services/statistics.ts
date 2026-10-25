// ===== Statistics service: channel summaries, time series, top products =====
// Reuses sales.ts / expenses.ts logic; never duplicates formulas.
// Only CONFIRMED sales count; cancelled never count; pending reported separately.

import type { DbAdapter } from '@/services/dbAdapter';
import { getSalesSummary, type SalesSummary } from '@/services/sales';
import { getProductFinancials, getExpensesTotal, type ProductFinancialRow } from '@/services/expenses';

export interface PeriodFilter {
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface ChannelBlock {
  salesCount: number;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface ChannelSummary {
  store: ChannelBlock;
  outside: ChannelBlock;
  combined: ChannelBlock;
  pendingCount: number;
  pendingExpectedRevenue: number;
  extraExpenses: number;
  netProfit: number; // combined.profit - extraExpenses
}

function toBlock(s: SalesSummary): ChannelBlock {
  return { salesCount: s.salesCount, unitsSold: s.unitsSold, revenue: s.revenue, cost: s.cost, profit: s.profit };
}

export async function getChannelSummary(db: DbAdapter, f: PeriodFilter = {}): Promise<ChannelSummary> {
  const [store, outside, all] = await Promise.all([
    getSalesSummary(db, { ...f, type: 'store' }),
    getSalesSummary(db, { ...f, type: 'outside' }),
    getSalesSummary(db, { ...f, type: 'all' }),
  ]);
  const extraExpenses = await getExpensesTotal(db, f);
  const storeB = toBlock(store);
  const outsideB = toBlock(outside);
  const combinedB = toBlock(all);
  return {
    store: storeB,
    outside: outsideB,
    combined: combinedB,
    pendingCount: all.pendingCount,
    pendingExpectedRevenue: all.pendingExpectedRevenue,
    extraExpenses,
    netProfit: combinedB.profit - extraExpenses,
  };
}

export interface TimeSeriesPoint {
  period: string; // YYYY-MM-DD (day), week start date, or YYYY-MM
  storeRevenue: number;
  outsideRevenue: number;
  profit: number;
  expenses: number;
}

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
function iso(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/** Monday-based week start. */
function weekStart(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return x;
}

function enumeratePeriods(dateFrom: string, dateTo: string, granularity: 'day' | 'week' | 'month'): string[] {
  const periods: string[] = [];
  const seen = new Set<string>();
  let cur = new Date(`${dateFrom}T00:00:00`);
  const end = new Date(`${dateTo}T00:00:00`);
  while (cur <= end) {
    let key: string;
    if (granularity === 'day') key = iso(cur);
    else if (granularity === 'week') key = iso(weekStart(cur));
    else key = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}`;
    if (!seen.has(key)) { seen.add(key); periods.push(key); }
    cur = addDays(cur, 1);
  }
  return periods;
}

/** Map a date string (YYYY-MM-DD ...) to its period key. */
function periodKey(dateStr: string, granularity: 'day' | 'week' | 'month'): string | null {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  if (granularity === 'day') return iso(d);
  if (granularity === 'week') return iso(weekStart(d));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export async function getSalesTimeSeries(
  db: DbAdapter,
  f: { dateFrom: string; dateTo: string; granularity: 'day' | 'week' | 'month' },
): Promise<TimeSeriesPoint[]> {
  const { dateFrom, dateTo, granularity } = f;
  const sales = await db.query<{ type: string; created_at: string; discount: number; line_total: number; cost_total: number }>(
    `SELECT s.type, s.created_at, s.discount,
            (SELECT COALESCE(SUM(si.quantity * si.sale_price), 0) FROM sale_items si WHERE si.sale_id = s.id) AS line_total,
            (SELECT COALESCE(SUM(si.quantity * si.purchase_price), 0) FROM sale_items si WHERE si.sale_id = s.id) AS cost_total
     FROM sales s
     WHERE s.status = 'confirmed' AND date(s.created_at) >= date(?) AND date(s.created_at) <= date(?)`,
    [dateFrom, dateTo],
  );
  const expenses = await db.query<{ created_at: string; amount: number }>(
    `SELECT created_at, amount FROM expenses WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)`,
    [dateFrom, dateTo],
  );
  const map = new Map<string, TimeSeriesPoint>();
  for (const p of enumeratePeriods(dateFrom.slice(0, 10), dateTo.slice(0, 10), granularity)) {
    map.set(p, { period: p, storeRevenue: 0, outsideRevenue: 0, profit: 0, expenses: 0 });
  }
  for (const s of sales) {
    const key = periodKey(s.created_at, granularity);
    if (!key) continue;
    const point = map.get(key);
    if (!point) continue;
    const revenue = s.line_total - s.discount;
    if (s.type === 'store') point.storeRevenue += revenue; else point.outsideRevenue += revenue;
    point.profit += revenue - s.cost_total;
  }
  for (const e of expenses) {
    const key = periodKey(e.created_at, granularity);
    if (!key) continue;
    const point = map.get(key);
    if (point) point.expenses += e.amount;
  }
  return [...map.values()];
}

export interface TopProductRow {
  product_id: number;
  name: string;
  sku: string;
  category_name: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
}

export async function getTopProducts(
  db: DbAdapter,
  f: PeriodFilter & { by?: 'units' | 'profit'; limit?: number } = {},
): Promise<TopProductRow[]> {
  const rows = await getProductFinancials(db, f);
  const by = f.by ?? 'units';
  const limit = f.limit ?? 5;
  return rows
    .filter((r) => r.soldUnits > 0)
    .sort((a, b) => (by === 'units' ? b.soldUnits - a.soldUnits || b.profit - a.profit : b.profit - a.profit || b.soldUnits - a.soldUnits))
    .slice(0, limit)
    .map((r) => ({
      product_id: r.product_id, name: r.name, sku: r.sku, category_name: r.category_name,
      unitsSold: r.soldUnits, revenue: r.soldRevenue, cost: r.soldCost, profit: r.profit,
    }));
}

export interface CategoryBreakdownRow {
  category_id: number;
  category_name: string;
  revenue: number;
  cost: number;
  profit: number;
  unitsSold: number;
}

export async function getCategoryBreakdown(db: DbAdapter, f: PeriodFilter = {}): Promise<CategoryBreakdownRow[]> {
  const rows = await getProductFinancials(db, f);
  const map = new Map<number, CategoryBreakdownRow>();
  for (const r of rows) {
    const id = r.category_id;
    const cur = map.get(id) ?? { category_id: id, category_name: r.category_name, revenue: 0, cost: 0, profit: 0, unitsSold: 0 };
    cur.revenue += r.soldRevenue;
    cur.cost += r.soldCost;
    cur.profit += r.profit;
    cur.unitsSold += r.soldUnits;
    map.set(id, cur);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export interface SlowMovingRow {
  product_id: number;
  name: string;
  sku: string;
  quantity: number;
  lastSaleAt: string | null;
}

export async function getSlowMovingProducts(db: DbAdapter, f: { days: number }): Promise<SlowMovingRow[]> {
  const days = Math.max(1, Math.floor(Number(f.days)));
  return db.query<SlowMovingRow>(
    `SELECT p.id AS product_id, p.name, p.sku, p.quantity,
            (SELECT COALESCE(MAX(s.created_at), '') FROM sales s JOIN sale_items si ON si.sale_id = s.id
             WHERE si.product_id = p.id AND s.status = 'confirmed') AS lastSaleAt
     FROM products p
     WHERE p.is_active = 1 AND p.quantity > 0
       AND (lastSaleAt = '' OR datetime(lastSaleAt) < datetime('now', ?, 'localtime'))
     ORDER BY (lastSaleAt = '') DESC, lastSaleAt ASC`,
    [`-${days} days`],
  );
}

export async function getStockAlerts(db: DbAdapter): Promise<ProductFinancialRow[]> {
  const rows = await getProductFinancials(db, {});
  return rows.filter((r) => r.quantity <= 0 || r.quantity <= r.low_stock_threshold);
}
