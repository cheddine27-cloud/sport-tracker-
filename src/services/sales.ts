// ===== Sales service: store sales (POS) and outside orders (exports) =====
// Stock is ONLY touched through increaseStock/decreaseStock from stock.ts,
// inside the SAME transaction that creates/updates the sale. All-or-nothing.

import type { DbAdapter } from '@/services/dbAdapter';
import { decreaseStock, increaseStock } from '@/services/stock';
import type { Sale, SaleItem, SaleStatus, SaleType } from '@/types';

const nowExpr = `datetime('now','localtime')`;

// ---------- types ----------

export interface SaleLineInput {
  productId: number;
  quantity: number;
  unitPrice?: number | null; // override of product.sale_price (integer >= 0)
}

export interface CreateSaleInput {
  items: SaleLineInput[];
  discount?: number;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  note?: string | null;
}

export interface SaleTotals {
  subtotal: number;
  discount: number;
  total: number;
  cost: number;
  profit: number;
}

export interface CreateSaleResult extends SaleTotals {
  saleId: number;
}

export interface SaleWithItems extends Sale {
  items: SaleItem[];
  subtotal: number;
  total: number;
  cost: number;
  profit: number;
}

export interface SalesListFilters {
  type?: SaleType | 'all' | null;
  status?: SaleStatus | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export interface SalesSummary {
  salesCount: number;
  revenue: number;
  cost: number;
  profit: number;
  unitsSold: number;
  pendingCount: number;
  pendingExpectedRevenue: number;
  pendingExpectedProfit: number;
}

// ---------- validation helpers ----------

function assertPositiveInt(q: unknown, label: string): number {
  const n = Number(q);
  if (!Number.isInteger(n)) throw new Error(`${label}: يجب أن يكون عددا صحيحا`);
  if (n <= 0) throw new Error(`${label}: يجب أن يكون أكبر من صفر`);
  return n;
}

function validateCommon(input: CreateSaleInput): SaleLineInput[] {
  const items = input.items ?? [];
  if (!Array.isArray(items) || items.length === 0) throw new Error('السلة فارغة: أضف منتجا واحدا على الأقل');
  for (const it of items) {
    assertPositiveInt(it.quantity, 'الكمية');
    if (it.unitPrice != null) {
      const p = Number(it.unitPrice);
      if (!Number.isInteger(p) || p < 0) throw new Error('سعر البيع يجب أن يكون عددا صحيحا أكبر من أو يساوي صفر');
    }
  }
  const disc = input.discount == null ? 0 : Number(input.discount);
  if (!Number.isInteger(disc) || disc < 0) throw new Error('الخصم يجب أن يكون عددا صحيحا أكبر من أو يساوي صفر');
  return items;
}

/** Merge duplicate product lines (sum quantities). */
function mergeLines(items: SaleLineInput[]): SaleLineInput[] {
  const map = new Map<number, SaleLineInput>();
  for (const it of items) {
    const key = it.productId;
    const price = it.unitPrice != null ? Number(it.unitPrice) : null;
    const prev = map.get(key);
    if (prev) {
      prev.quantity += it.quantity;
      if (price != null) prev.unitPrice = price; // last explicit override wins
    } else {
      map.set(key, { productId: key, quantity: Number(it.quantity), unitPrice: price });
    }
  }
  return [...map.values()];
}

const PHONE_RE = /^[0-9+\-\s]+$/;

function validateOutsideCustomer(input: CreateSaleInput): void {
  const name = (input.customerName ?? '').trim();
  if (!name) throw new Error('اسم الزبون مطلوب لطلب التصدير');
  const phone = (input.customerPhone ?? '').trim();
  if (!phone) throw new Error('رقم الهاتف مطلوب لطلب التصدير');
  if (!PHONE_RE.test(phone)) throw new Error('رقم الهاتف غير صالح: يُسمح بالأرقام والمسافات و + و - فقط');
  const digits = phone.replace(/\D/g, '').replace(/^00/, '');
  if (digits.length < 8) throw new Error('رقم الهاتف غير صالح: يجب أن يحتوي على 8 أرقام على الأقل');
}

// ---------- core creation (shared by store & outside) ----------

async function createSale(
  db: DbAdapter,
  type: SaleType,
  status: SaleStatus,
  movementType: 'sale_store' | 'sale_outside',
  input: CreateSaleInput,
): Promise<CreateSaleResult> {
  const rawItems = validateCommon(input);
  const items = mergeLines(rawItems);
  const discount = input.discount == null ? 0 : Number(input.discount);
  if (type === 'outside') validateOutsideCustomer(input);

  return db.transaction(async (tx) => {
    // Load products first to compute totals BEFORE inserting anything.
    let subtotal = 0;
    let cost = 0;
    const lines: { product: { id: number; name: string; purchase_price: number; sale_price: number }; quantity: number; unitPrice: number }[] = [];
    for (const it of items) {
      const rows = await tx.query<{ id: number; name: string; purchase_price: number; sale_price: number; quantity: number; is_active: number }>(
        `SELECT id, name, purchase_price, sale_price, quantity, is_active FROM products WHERE id = ?`,
        [it.productId],
      );
      if (rows.length === 0) throw new Error('المنتج غير موجود');
      const p = rows[0];
      if (!p.is_active) throw new Error(`لا يمكن بيع المنتج (${p.name}) لأنه محذوف`);
      const unitPrice = it.unitPrice != null ? Number(it.unitPrice) : p.sale_price;
      subtotal += it.quantity * unitPrice;
      cost += it.quantity * p.purchase_price;
      lines.push({ product: { id: p.id, name: p.name, purchase_price: p.purchase_price, sale_price: p.sale_price }, quantity: Number(it.quantity), unitPrice });
    }
    if (discount > subtotal) throw new Error('الخصم أكبر من مجموع الفاتورة');
    const total = subtotal - discount;
    const profit = total - cost;

    const res = await tx.execute(
      `INSERT INTO sales (type, status, customer_name, customer_phone, customer_address, discount, note, created_at${status === 'confirmed' ? ', confirmed_at' : ''})
       VALUES (?, ?, ?, ?, ?, ?, ?, ${nowExpr}${status === 'confirmed' ? `, ${nowExpr}` : ''})`,
      [
        type,
        status,
        input.customerName?.trim() || null,
        input.customerPhone?.trim() || null,
        input.customerAddress?.trim() || null,
        discount,
        input.note?.trim() || null,
      ],
    );
    const saleId = res.lastInsertId!;

    for (const line of lines) {
      await tx.execute(
        `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, purchase_price, sale_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [saleId, line.product.id, line.product.name, line.quantity, line.product.purchase_price, line.unitPrice],
      );
      // Decrease stock AFTER the sale row exists so referenceId points to it.
      await decreaseStock(tx, {
        productId: line.product.id,
        quantity: line.quantity,
        type: movementType,
        referenceId: saleId,
        note: type === 'store' ? `بيع في المحل رقم ${saleId}` : `طلب تصدير رقم ${saleId}`,
      });
    }
    return { saleId, subtotal, discount, total, cost, profit };
  });
}

// ---------- public API ----------

/** In-store sale: created confirmed, stock decreased immediately. */
export async function createStoreSale(db: DbAdapter, input: CreateSaleInput): Promise<CreateSaleResult> {
  return createSale(db, 'store', 'confirmed', 'sale_store', input);
}

/** Outside order: created pending, stock reserved (decreased) immediately. */
export async function createOutsideSale(db: DbAdapter, input: CreateSaleInput): Promise<CreateSaleResult> {
  return createSale(db, 'outside', 'pending', 'sale_outside', input);
}

/** Confirm delivery of a pending outside order. Stock untouched. */
export async function confirmOutsideSale(db: DbAdapter, saleId: number): Promise<void> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<Sale>(`SELECT * FROM sales WHERE id = ?`, [saleId]);
    if (rows.length === 0) throw new Error('الطلب غير موجود');
    const s = rows[0];
    if (s.type !== 'outside') throw new Error('تأكيد التسليم خاص بطلبات التصدير فقط');
    if (s.status === 'confirmed') throw new Error('هذا الطلب مؤكد مسبقا');
    if (s.status === 'cancelled') throw new Error('لا يمكن تأكيد طلب ملغى');
    await tx.execute(`UPDATE sales SET status = 'confirmed', confirmed_at = ${nowExpr} WHERE id = ?`, [saleId]);
  });
}

/** Cancel a PENDING outside order: restore stock with a 'cancel_return' movement. */
export async function cancelOutsideSale(db: DbAdapter, saleId: number, reason?: string): Promise<void> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<Sale>(`SELECT * FROM sales WHERE id = ?`, [saleId]);
    if (rows.length === 0) throw new Error('الطلب غير موجود');
    const s = rows[0];
    if (s.type !== 'outside') throw new Error('إلغاء الطلب خاص بطلبات التصدير فقط — استعمل إلغاء الفاتورة للمبيعات');
    if (s.status === 'cancelled') throw new Error('هذا الطلب ملغى مسبقا');
    if (s.status === 'confirmed') throw new Error('لا يمكن إلغاء طلب مؤكد التسليم');
    const items = await tx.query<SaleItem>(`SELECT * FROM sale_items WHERE sale_id = ?`, [saleId]);
    await tx.execute(`UPDATE sales SET status = 'cancelled', cancelled_at = ${nowExpr} WHERE id = ?`, [saleId]);
    for (const it of items) {
      await increaseStock(tx, {
        productId: it.product_id,
        quantity: it.quantity,
        type: 'cancel_return',
        referenceId: saleId,
        note: reason?.trim() ? `إلغاء طلب رقم ${saleId} - ${reason.trim()}` : `إلغاء طلب رقم ${saleId}`,
      });
    }
  });
}

/** Cancel a CONFIRMED store sale: restore stock with a 'return' movement. */
export async function cancelStoreSale(db: DbAdapter, saleId: number, reason?: string): Promise<void> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<Sale>(`SELECT * FROM sales WHERE id = ?`, [saleId]);
    if (rows.length === 0) throw new Error('الفاتورة غير موجودة');
    const s = rows[0];
    if (s.type !== 'store') throw new Error('إلغاء الفاتورة خاص بمبيعات المحل فقط');
    if (s.status === 'cancelled') throw new Error('هذه الفاتورة ملغاة مسبقا');
    if (s.status !== 'confirmed') throw new Error('لا يمكن إلغاء فاتورة غير مؤكدة');
    const items = await tx.query<SaleItem>(`SELECT * FROM sale_items WHERE sale_id = ?`, [saleId]);
    await tx.execute(`UPDATE sales SET status = 'cancelled', cancelled_at = ${nowExpr} WHERE id = ?`, [saleId]);
    for (const it of items) {
      await increaseStock(tx, {
        productId: it.product_id,
        quantity: it.quantity,
        type: 'return',
        referenceId: saleId,
        note: reason?.trim() ? `إلغاء فاتورة رقم ${saleId} - ${reason.trim()}` : `إلغاء فاتورة رقم ${saleId}`,
      });
    }
  });
}

// ---------- queries ----------

async function attachTotals(db: DbAdapter, sales: Sale[]): Promise<SaleWithItems[]> {
  const out: SaleWithItems[] = [];
  for (const s of sales) {
    const items = await db.query<SaleItem>(`SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id`, [s.id]);
    const subtotal = items.reduce((a, i) => a + i.quantity * i.sale_price, 0);
    const cost = items.reduce((a, i) => a + i.quantity * i.purchase_price, 0);
    const total = Math.max(0, subtotal - s.discount);
    out.push({ ...s, items, subtotal, total, cost, profit: total - cost });
  }
  return out;
}

export async function getSaleById(db: DbAdapter, id: number): Promise<SaleWithItems | null> {
  const rows = await db.query<Sale>(`SELECT * FROM sales WHERE id = ?`, [id]);
  if (rows.length === 0) return null;
  const [withTotals] = await attachTotals(db, rows);
  return withTotals;
}

export async function getSales(db: DbAdapter, f: SalesListFilters = {}): Promise<SaleWithItems[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.type && f.type !== 'all') { where.push('s.type = ?'); params.push(f.type); }
  if (f.status) { where.push('s.status = ?'); params.push(f.status); }
  if (f.dateFrom) { where.push('date(s.created_at) >= date(?)'); params.push(f.dateFrom); }
  if (f.dateTo) { where.push('date(s.created_at) <= date(?)'); params.push(f.dateTo); }
  if (f.search && f.search.trim()) {
    const q = `%${f.search.trim().toLowerCase()}%`;
    where.push(`(LOWER(COALESCE(s.customer_name,'')) LIKE ? OR COALESCE(s.customer_phone,'') LIKE ? OR CAST(s.id AS TEXT) = ?)`);
    params.push(q, q, f.search.trim());
  }
  const limit = f.limit ?? 100;
  const offset = f.offset ?? 0;
  const rows = await db.query<Sale>(
    `SELECT s.* FROM sales s ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    params,
  );
  return attachTotals(db, rows);
}

export async function getPendingOutsideSales(db: DbAdapter): Promise<SaleWithItems[]> {
  return getSales(db, { type: 'outside', status: 'pending' });
}

/**
 * Revenue/cost/profit/units count ONLY confirmed sales.
 * Pending outside orders are reported separately in pending* fields.
 */
export async function getSalesSummary(
  db: DbAdapter,
  f: { dateFrom?: string | null; dateTo?: string | null; type?: SaleType | 'all' | null } = {},
): Promise<SalesSummary> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.type && f.type !== 'all') { where.push('s.type = ?'); params.push(f.type); }
  if (f.dateFrom) { where.push('date(s.created_at) >= date(?)'); params.push(f.dateFrom); }
  if (f.dateTo) { where.push('date(s.created_at) <= date(?)'); params.push(f.dateTo); }
  const clause = where.length ? 'AND ' + where.join(' AND ') : '';

  const conf = await db.query<{ salesCount: number; revenue: number; cost: number; unitsSold: number }>(
    `SELECT COUNT(*) AS salesCount,
            COALESCE(SUM(line_total - discount), 0) AS revenue,
            COALESCE(SUM(cost_total), 0) AS cost,
            COALESCE(SUM(units), 0) AS unitsSold
     FROM (
       SELECT s.id, s.discount,
              COALESCE((SELECT SUM(si.quantity * si.sale_price) FROM sale_items si WHERE si.sale_id = s.id), 0) AS line_total,
              COALESCE((SELECT SUM(si.quantity * si.purchase_price) FROM sale_items si WHERE si.sale_id = s.id), 0) AS cost_total,
              COALESCE((SELECT SUM(si.quantity) FROM sale_items si WHERE si.sale_id = s.id), 0) AS units
       FROM sales s
       WHERE s.status = 'confirmed' ${clause}
     )`,
    params,
  );
  // Pending totals only apply to outside orders. Build a date-only clause for them.
  const pendWhere: string[] = [];
  const pendParams: unknown[] = [];
  if (f.dateFrom) { pendWhere.push('date(s.created_at) >= date(?)'); pendParams.push(f.dateFrom); }
  if (f.dateTo) { pendWhere.push('date(s.created_at) <= date(?)'); pendParams.push(f.dateTo); }
  const pendClause = pendWhere.length ? 'AND ' + pendWhere.join(' AND ') : '';
  const includePending = !f.type || f.type === 'all' || f.type === 'outside';

  const pend = includePending
    ? await db.query<{ pendingCount: number; pendingExpectedRevenue: number; pendingExpectedProfit: number }>(
        `SELECT COUNT(*) AS pendingCount,
                COALESCE(SUM(line_total - discount), 0) AS pendingExpectedRevenue,
                COALESCE(SUM(line_total - cost_total), 0) AS pendingExpectedProfit
         FROM (
           SELECT s.id, s.discount,
                  COALESCE((SELECT SUM(si.quantity * si.sale_price) FROM sale_items si WHERE si.sale_id = s.id), 0) AS line_total,
                  COALESCE((SELECT SUM(si.quantity * si.purchase_price) FROM sale_items si WHERE si.sale_id = s.id), 0) AS cost_total
           FROM sales s
           WHERE s.status = 'pending' AND s.type = 'outside' ${pendClause}
         )`,
        pendParams,
      )
    : [{ pendingCount: 0, pendingExpectedRevenue: 0, pendingExpectedProfit: 0 }];
  const c = conf[0];
  const p = pend[0];
  return {
    salesCount: c.salesCount,
    revenue: c.revenue,
    cost: c.cost,
    profit: c.revenue - c.cost,
    unitsSold: c.unitsSold,
    pendingCount: p.pendingCount,
    pendingExpectedRevenue: p.pendingExpectedRevenue,
    pendingExpectedProfit: p.pendingExpectedProfit,
  };
}
