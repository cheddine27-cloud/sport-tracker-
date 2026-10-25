// ===== Stock service: the ONLY way products.quantity may change =====
// Every quantity change happens inside a transaction together with a
// stock_movements row. Invariant: products.quantity == SUM(quantity_change)
// and the latest movement's quantity_after == products.quantity.

import type { DbAdapter } from '@/services/dbAdapter';
import type { MovementType, Product, StockMovement } from '@/types';

// ---------- types ----------

export interface IncreaseParams {
  productId: number;
  quantity: number;
  type: Extract<MovementType, 'restock' | 'return' | 'cancel_return' | 'adjustment'>;
  referenceId?: number | null;
  note?: string | null;
}

export interface DecreaseParams {
  productId: number;
  quantity: number;
  type: Extract<MovementType, 'sale_store' | 'sale_outside' | 'adjustment'>;
  referenceId?: number | null;
  note?: string | null;
}

export interface RestockInput {
  productId: number;
  quantity: number;
  newPurchasePrice?: number | null;
  note?: string | null;
}

export interface MovementFilters {
  productId?: number | null;
  type?: MovementType | null;
  dateFrom?: string | null; // ISO date (inclusive)
  dateTo?: string | null;   // ISO date (inclusive)
  limit?: number;
  offset?: number;
}

export interface InventorySummary {
  totalProducts: number;
  totalUnits: number;
  stockValueAtCost: number;
  stockValueAtSale: number;
  expectedProfit: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface InventoryRow {
  id: number;
  name: string;
  sku: string;
  categoryName: string;
  quantity: number;
  purchase_price: number;
  sale_price: number;
  low_stock_threshold: number;
  stockValueAtCost: number;
  expectedProfit: number;
  status: 'ok' | 'low' | 'out';
}

export interface MovementRow extends StockMovement {
  product_name: string;
  product_sku: string;
}

// ---------- helpers ----------

function assertPositiveInt(q: unknown, label: string): number {
  const n = Number(q);
  if (!Number.isInteger(n)) throw new Error(`${label}: يجب أن يكون عددا صحيحا`);
  if (n <= 0) throw new Error(`${label}: يجب أن يكون أكبر من صفر`);
  return n;
}

async function loadProduct(db: DbAdapter, productId: number): Promise<Product> {
  const rows = await db.query<Product>(
    `SELECT p.*, c.name AS categoryName FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
    [productId],
  );
  if (rows.length === 0) throw new Error('المنتج غير موجود');
  return rows[0];
}

const nowExpr = `datetime('now','localtime')`;

// ---------- low-level (transaction-scoped, reused later by sales) ----------

const INCREASE_TYPES: readonly string[] = ['restock', 'return', 'cancel_return', 'adjustment'];
const DECREASE_TYPES: readonly string[] = ['sale_store', 'sale_outside', 'adjustment'];

/** Increase stock and write the movement — MUST run inside a transaction. */
export async function increaseStock(tx: DbAdapter, p: IncreaseParams): Promise<{ quantityAfter: number }> {
  const qty = assertPositiveInt(p.quantity, 'الكمية');
  if (!INCREASE_TYPES.includes(p.type)) throw new Error('نوع الحركة غير مسموح للزيادة');
  const product = await loadProduct(tx, p.productId);
  if (!product.is_active) throw new Error(`المنتج (${product.name}) محذوف ولا يمكن تزويده`);

  await tx.execute(
    `UPDATE products SET quantity = quantity + ?, updated_at = ${nowExpr} WHERE id = ?`,
    [qty, p.productId],
  );
  const after = await tx.query<{ quantity: number }>(`SELECT quantity FROM products WHERE id = ?`, [p.productId]);
  const quantityAfter = after[0].quantity;
  await tx.execute(
    `INSERT INTO stock_movements (product_id, type, quantity_change, quantity_after, reference_id, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [p.productId, p.type, qty, quantityAfter, p.referenceId ?? null, p.note ?? null],
  );
  return { quantityAfter };
}

/** Atomically decrease stock (conditional UPDATE) and write the movement. */
export async function decreaseStock(tx: DbAdapter, p: DecreaseParams): Promise<{ quantityAfter: number }> {
  const qty = assertPositiveInt(p.quantity, 'الكمية');
  if (!DECREASE_TYPES.includes(p.type)) throw new Error('نوع الحركة غير مسموح للنقصان');
  const product = await loadProduct(tx, p.productId);
  if (!product.is_active) throw new Error(`المنتج (${product.name}) محذوف ولا يمكن بيعه`);

  const res = await tx.execute(
    `UPDATE products SET quantity = quantity - ?, updated_at = ${nowExpr}
     WHERE id = ? AND quantity >= ? AND is_active = 1`,
    [qty, p.productId, qty],
  );
  if (res.rowsAffected === 0) {
    throw new Error(`الكمية المتوفرة من (${product.name}) هي ${product.quantity} فقط`);
  }
  const after = await tx.query<{ quantity: number }>(`SELECT quantity FROM products WHERE id = ?`, [p.productId]);
  const quantityAfter = after[0].quantity;
  await tx.execute(
    `INSERT INTO stock_movements (product_id, type, quantity_change, quantity_after, reference_id, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [p.productId, p.type, -qty, quantityAfter, p.referenceId ?? null, p.note ?? null],
  );
  return { quantityAfter };
}

// ---------- high-level (each opens ONE transaction) ----------

/** Restock one product. If newPurchasePrice differs, update it and note it. */
export async function restockProduct(db: DbAdapter, input: RestockInput): Promise<{ quantityAfter: number }> {
  const qty = assertPositiveInt(input.quantity, 'الكمية');
  return db.transaction(async (tx) => {
    let note = input.note?.trim() ? input.note.trim() : null;
    if (input.newPurchasePrice != null) {
      const price = Number(input.newPurchasePrice);
      if (!Number.isInteger(price) || price < 0) throw new Error('سعر الشراء يجب أن يكون عددا صحيحا أكبر من أو يساوي صفر');
      const product = await loadProduct(tx, input.productId);
      if (price !== product.purchase_price) {
        await tx.execute(`UPDATE products SET purchase_price = ?, updated_at = ${nowExpr} WHERE id = ?`, [price, input.productId]);
        const priceNote = `تحديث سعر الشراء من ${product.purchase_price} إلى ${price}`;
        note = note ? `${note} - ${priceNote}` : priceNote;
      }
    }
    return increaseStock(tx, { productId: input.productId, quantity: qty, type: 'restock', note });
  });
}

/** Restock many products — all or nothing. */
export async function restockMany(db: DbAdapter, items: RestockInput[]): Promise<{ results: { productId: number; quantityAfter: number }[] }> {
  if (!Array.isArray(items) || items.length === 0) throw new Error('لا توجد منتجات للتزويد');
  return db.transaction(async (tx) => {
    const results: { productId: number; quantityAfter: number }[] = [];
    for (const it of items) {
      const qty = assertPositiveInt(it.quantity, 'الكمية');
      let note = it.note?.trim() ? it.note.trim() : null;
      if (it.newPurchasePrice != null) {
        const price = Number(it.newPurchasePrice);
        if (!Number.isInteger(price) || price < 0) throw new Error('سعر الشراء يجب أن يكون عددا صحيحا أكبر من أو يساوي صفر');
        const product = await loadProduct(tx, it.productId);
        if (price !== product.purchase_price) {
          await tx.execute(`UPDATE products SET purchase_price = ?, updated_at = ${nowExpr} WHERE id = ?`, [price, it.productId]);
          const priceNote = `تحديث سعر الشراء من ${product.purchase_price} إلى ${price}`;
          note = note ? `${note} - ${priceNote}` : priceNote;
        }
      }
      const r = await increaseStock(tx, { productId: it.productId, quantity: qty, type: 'restock', note });
      results.push({ productId: it.productId, quantityAfter: r.quantityAfter });
    }
    return { results };
  });
}

/** Physical-count adjustment: writes an 'adjustment' movement with the difference. */
export async function adjustStock(
  db: DbAdapter,
  input: { productId: number; newQuantity: number; reason: string },
): Promise<{ changed: boolean; message: string }> {
  const reason = (input.reason ?? '').trim();
  if (!reason) throw new Error('السبب مطلوب عند تعديل الكمية');
  const newQty = Number(input.newQuantity);
  if (!Number.isInteger(newQty) || newQty < 0) throw new Error('الكمية الجديدة يجب أن تكون عددا صحيحا أكبر من أو يساوي صفر');

  return db.transaction(async (tx) => {
    const product = await loadProduct(tx, input.productId);
    const diff = newQty - product.quantity;
    if (diff === 0) return { changed: false, message: `لا تغيير: كمية المنتج (${product.name}) مطابقة للجرد` };
    if (diff > 0) {
      await increaseStock(tx, { productId: input.productId, quantity: diff, type: 'adjustment', note: reason });
    } else {
      await decreaseStock(tx, { productId: input.productId, quantity: -diff, type: 'adjustment', note: reason });
    }
    return { changed: true, message: `تم تعديل كمية (${product.name}) من ${product.quantity} إلى ${newQty}` };
  });
}

// ---------- queries ----------

export async function getStockMovements(db: DbAdapter, f: MovementFilters = {}): Promise<MovementRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.productId) { where.push('m.product_id = ?'); params.push(f.productId); }
  if (f.type) { where.push('m.type = ?'); params.push(f.type); }
  if (f.dateFrom) { where.push('date(m.created_at) >= date(?)'); params.push(f.dateFrom); }
  if (f.dateTo) { where.push('date(m.created_at) <= date(?)'); params.push(f.dateTo); }
  const limit = f.limit ?? 50;
  const offset = f.offset ?? 0;
  const sql = `
    SELECT m.*, p.name AS product_name, p.sku AS product_sku
    FROM stock_movements m JOIN products p ON p.id = m.product_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY m.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;
  return db.query<MovementRow>(sql, params);
}

export async function getInventorySummary(db: DbAdapter): Promise<InventorySummary> {
  const rows = await db.query<Omit<InventorySummary, 'expectedProfit'>>(`
    SELECT COUNT(*) AS totalProducts,
           COALESCE(SUM(quantity), 0) AS totalUnits,
           COALESCE(SUM(quantity * purchase_price), 0) AS stockValueAtCost,
           COALESCE(SUM(quantity * sale_price), 0) AS stockValueAtSale,
           COALESCE(SUM(CASE WHEN quantity > 0 AND quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) AS lowStockCount,
           COALESCE(SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END), 0) AS outOfStockCount
    FROM products WHERE is_active = 1`);
  const s = rows[0];
  return { ...s, expectedProfit: s.stockValueAtSale - s.stockValueAtCost };
}

export async function getInventoryRows(
  db: DbAdapter,
  f: { search?: string; categoryId?: number | null; status?: 'ok' | 'low' | 'out' | null } = {},
): Promise<InventoryRow[]> {
  const where: string[] = ['p.is_active = 1'];
  const params: unknown[] = [];
  if (f.search && f.search.trim()) {
    const q = `%${f.search.trim().toLowerCase()}%`;
    where.push('(LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ?)');
    params.push(q, q);
  }
  if (f.categoryId) { where.push('p.category_id = ?'); params.push(f.categoryId); }
  if (f.status === 'ok') where.push('p.quantity > p.low_stock_threshold');
  if (f.status === 'low') where.push('p.quantity > 0 AND p.quantity <= p.low_stock_threshold');
  if (f.status === 'out') where.push('p.quantity = 0');
  const rows = await db.query<InventoryRow>(`
    SELECT p.id, p.name, p.sku, c.name AS categoryName, p.quantity,
           p.purchase_price, p.sale_price, p.low_stock_threshold,
           p.quantity * p.purchase_price AS stockValueAtCost,
           p.quantity * (p.sale_price - p.purchase_price) AS expectedProfit,
           CASE WHEN p.quantity = 0 THEN 'out'
                WHEN p.quantity <= p.low_stock_threshold THEN 'low'
                ELSE 'ok' END AS status
    FROM products p JOIN categories c ON c.id = p.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.name`, params);
  return rows;
}

export async function getLowStockProducts(db: DbAdapter): Promise<InventoryRow[]> {
  return getInventoryRows(db, {}).then((rows) => rows.filter((r) => r.status !== 'ok'));
}

/** Products whose quantity no longer matches SUM(stock_movements.quantity_change). */
export async function verifyStockIntegrity(db: DbAdapter): Promise<{ productId: number; name: string; quantity: number; sumMoves: number }[]> {
  return db.query(`
    SELECT p.id AS productId, p.name, p.quantity,
           COALESCE((SELECT SUM(m.quantity_change) FROM stock_movements m WHERE m.product_id = p.id), 0) AS sumMoves
    FROM products p
    WHERE p.quantity <> COALESCE((SELECT SUM(m.quantity_change) FROM stock_movements m WHERE m.product_id = p.id), 0)`);
}
