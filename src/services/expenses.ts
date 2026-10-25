// ===== Expenses + per-product financials =====
// All amounts are INTEGER dinars. Only CONFIRMED sales count; cancelled never count.
// Discount of a sale is allocated to its lines proportionally to line totals,
// rounded, with the remainder pushed to the LAST line so sums stay exact.

import type { DbAdapter } from '@/services/dbAdapter';
import type { Expense } from '@/types';

export interface ExpenseInput {
  description: string;
  amount: number;
  date?: string | null; // ISO date (YYYY-MM-DD) or datetime; default = now
}

export interface ProductFinancialRow {
  product_id: number;
  name: string;
  sku: string;
  category_name: string;
  quantity: number;          // units in stock
  low_stock_threshold: number;
  category_id: number;
  purchase_price: number;
  sale_price: number;
  stockCost: number;         // quantity * purchase_price
  soldUnits: number;         // confirmed sales only
  soldRevenue: number;       // after proportional discount share
  soldCost: number;          // purchase_price snapshots
  profit: number;            // soldRevenue - soldCost
  pendingUnits: number;      // pending outside orders
  pendingExpectedProfit: number;
}

export interface FinancialSummary {
  totalStockCost: number;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  extraExpenses: number;
  netProfit: number;
  pendingExpectedProfit: number;
}

// ---------- CRUD ----------

function validateExpense(input: ExpenseInput): { description: string; amount: number } {
  const description = (input.description ?? '').trim();
  if (!description) throw new Error('وصف المصروف مطلوب');
  const amount = Number(input.amount);
  if (!Number.isInteger(amount)) throw new Error('المبلغ يجب أن يكون عددا صحيحا');
  if (amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  return { description, amount };
}

export async function addExpense(db: DbAdapter, input: ExpenseInput): Promise<{ expenseId: number }> {
  const { description, amount } = validateExpense(input);
  const date = input.date?.trim();
  let res;
  if (date) {
    res = await db.execute(`INSERT INTO expenses (description, amount, created_at) VALUES (?, ?, ?)`, [description, amount, date]);
  } else {
    res = await db.execute(`INSERT INTO expenses (description, amount, created_at) VALUES (?, ?, datetime('now','localtime'))`, [description, amount]);
  }
  return { expenseId: res.lastInsertId! };
}

export async function updateExpense(db: DbAdapter, id: number, input: ExpenseInput): Promise<void> {
  const { description, amount } = validateExpense(input);
  const res = await db.execute(`UPDATE expenses SET description = ?, amount = ? WHERE id = ?`, [description, amount, id]);
  if (res.rowsAffected === 0) throw new Error('المصروف غير موجود');
}

export async function deleteExpense(db: DbAdapter, id: number): Promise<void> {
  const res = await db.execute(`DELETE FROM expenses WHERE id = ?`, [id]);
  if (res.rowsAffected === 0) throw new Error('المصروف غير موجود');
}

export async function getExpenses(db: DbAdapter, f: { dateFrom?: string | null; dateTo?: string | null } = {}): Promise<Expense[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.dateFrom) { where.push('date(created_at) >= date(?)'); params.push(f.dateFrom); }
  if (f.dateTo) { where.push('date(created_at) <= date(?)'); params.push(f.dateTo); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.query<Expense>(`SELECT * FROM expenses ${clause} ORDER BY created_at DESC, id DESC`, params);
}

export async function getExpensesTotal(db: DbAdapter, f: { dateFrom?: string | null; dateTo?: string | null } = {}): Promise<number> {
  const rows = await getExpenses(db, f);
  return rows.reduce((s, e) => s + e.amount, 0);
}

// ---------- per-product financials ----------

interface RawSaleItem {
  product_id: number;
  quantity: number;
  sale_price: number;
  purchase_price: number;
  sale_id: number;
  discount: number;
  sale_line_total: number;
}

/** Fetch confirmed sale items joined with their sale-level discount and subtotal. */
async function getConfirmedItems(db: DbAdapter, f: PeriodFilter): Promise<RawSaleItem[]> {
  const where: string[] = ["s.status = 'confirmed'"];
  const params: unknown[] = [];
  if (f.dateFrom) { where.push('date(s.created_at) >= date(?)'); params.push(f.dateFrom); }
  if (f.dateTo) { where.push('date(s.created_at) <= date(?)'); params.push(f.dateTo); }
  return db.query<RawSaleItem>(
    `SELECT si.product_id, si.quantity, si.sale_price, si.purchase_price, s.id AS sale_id, s.discount,
            (SELECT SUM(si2.quantity * si2.sale_price) FROM sale_items si2 WHERE si2.sale_id = s.id) AS sale_line_total
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE ${where.join(' AND ')}
     ORDER BY s.id ASC, si.id ASC`,
    params,
  );
}

/**
 * Allocate each sale's discount across its lines proportionally to line totals.
 * Returns per-line net revenue (integer). Remainder goes to the last line so
 * sum(line revenues) == sale total exactly.
 */
export function allocateDiscount(lines: { qtyPrice: number }[], discount: number): number[] {
  const total = lines.reduce((s, l) => s + l.qtyPrice, 0);
  if (discount === 0 || total === 0) return lines.map((l) => l.qtyPrice);
  const shares = lines.map((l) => Math.floor((l.qtyPrice * discount) / total));
  const remainder = discount - shares.reduce((s, v) => s + v, 0);
  shares[shares.length - 1] += remainder; // push rounding remainder to last line
  return lines.map((l, i) => l.qtyPrice - shares[i]);
}

interface PeriodFilter {
  dateFrom?: string | null;
  dateTo?: string | null;
}

export async function getProductFinancials(
  db: DbAdapter,
  f: PeriodFilter & { search?: string | null; categoryId?: number | null } = {},
): Promise<ProductFinancialRow[]> {
  const where: string[] = ['p.is_active = 1'];
  const params: unknown[] = [];
  if (f.categoryId) { where.push('p.category_id = ?'); params.push(f.categoryId); }
  if (f.search?.trim()) {
    const s = `%${f.search.trim()}%`;
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.color LIKE ?)');
    params.push(s, s, s);
  }
  const products = await db.query<{
    product_id: number; name: string; sku: string; category_name: string;
    quantity: number; purchase_price: number; sale_price: number;
    low_stock_threshold: number; category_id: number;
  }>(
    `SELECT p.id AS product_id, p.name, p.sku, c.name AS category_name,
            p.quantity, p.purchase_price, p.sale_price,
            p.low_stock_threshold, p.category_id
     FROM products p JOIN categories c ON c.id = p.category_id
     WHERE ${where.join(' AND ')} ORDER BY p.id`,
    params,
  );

  // Confirmed sales per product (with discount allocation done in JS for exactness).
  const items = await getConfirmedItems(db, f);
  const bySale = new Map<number, RawSaleItem[]>();
  for (const it of items) {
    const arr = bySale.get(it.sale_id) ?? [];
    arr.push(it);
    bySale.set(it.sale_id, arr);
  }
  const sold = new Map<number, { units: number; revenue: number; cost: number }>();
  for (const [, lines] of bySale) {
    const discount = lines[0].discount;
    const revenues = allocateDiscount(lines.map((l) => ({ qtyPrice: l.quantity * l.sale_price })), discount);
    lines.forEach((l, i) => {
      const cur = sold.get(l.product_id) ?? { units: 0, revenue: 0, cost: 0 };
      cur.units += l.quantity;
      cur.revenue += revenues[i];
      cur.cost += l.quantity * l.purchase_price;
      sold.set(l.product_id, cur);
    });
  }

  // Pending outside orders per product (same period filter on created_at).
  const pendWhere: string[] = ["s.status = 'pending'", "s.type = 'outside'"];
  const pendParams: unknown[] = [];
  if (f.dateFrom) { pendWhere.push('date(s.created_at) >= date(?)'); pendParams.push(f.dateFrom); }
  if (f.dateTo) { pendWhere.push('date(s.created_at) <= date(?)'); pendParams.push(f.dateTo); }
  const pendItems = await db.query<{ product_id: number; units: number; revenue: number; cost: number }>(
    `SELECT si.product_id,
            SUM(si.quantity) AS units,
            SUM(si.quantity * si.sale_price) AS revenue,
            SUM(si.quantity * si.purchase_price) AS cost
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE ${pendWhere.join(' AND ')}
     GROUP BY si.product_id`,
    pendParams,
  );
  const pending = new Map(pendItems.map((r) => [r.product_id, r]));

  const rows = products.map((p) => {
    const s = sold.get(p.product_id) ?? { units: 0, revenue: 0, cost: 0 };
    const pe = pending.get(p.product_id) ?? { units: 0, revenue: 0, cost: 0 };
    return {
      ...p,
      stockCost: p.quantity * p.purchase_price,
      soldUnits: s.units,
      soldRevenue: s.revenue,
      soldCost: s.cost,
      profit: s.revenue - s.cost,
      pendingUnits: pe.units,
      pendingExpectedProfit: pe.revenue - pe.cost,
    };
  });
  return rows.sort((a, b) => b.profit - a.profit || a.product_id - b.product_id);
}

export async function getFinancialSummary(
  db: DbAdapter,
  f: PeriodFilter = {},
): Promise<FinancialSummary> {
  const rows = await getProductFinancials(db, f);
  const sum = (pick: (r: ProductFinancialRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const totalStockCost = sum((r) => r.stockCost);
  const totalRevenue = sum((r) => r.soldRevenue);
  const totalCost = sum((r) => r.soldCost);
  const grossProfit = totalRevenue - totalCost;
  const extraExpenses = await getExpensesTotal(db, f);
  const pendingExpectedProfit = sum((r) => r.pendingExpectedProfit);
  return {
    totalStockCost,
    totalRevenue,
    totalCost,
    grossProfit,
    extraExpenses,
    netProfit: grossProfit - extraExpenses,
    pendingExpectedProfit,
  };
}
