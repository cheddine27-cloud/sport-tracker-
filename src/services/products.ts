import type { DbAdapter } from './dbAdapter';
import { normalizeName, sameOptional } from './dbAdapter';
import type { Product } from '@/types';

// ===== Input / option types =====

export interface ProductInput {
  sku: string;
  name: string;
  categoryId: number;
  size?: string | null;
  color?: string | null;
  material?: string | null;
  purchasePrice: number;
  salePrice: number;
  /** Only used when creating (initial stock). Ignored on update. */
  quantity?: number;
  lowStockThreshold?: number;
}

export interface ProductFilters {
  search?: string;
  categoryId?: number | null;
  includeInactive?: boolean;
}

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name
  FROM products p
  JOIN categories c ON c.id = p.category_id
`;

function mapRow(row: Product & { category_name?: string }): Product {
  const { category_name, ...rest } = row;
  return { ...rest, categoryName: category_name };
}

// ===== Validation (Arabic messages) =====

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

export function validateProductInput(input: ProductInput, isNew: boolean): void {
  if (!input.name || !input.name.trim()) {
    throw new Error('اسم المنتج مطلوب.');
  }
  if (!input.sku || !input.sku.trim()) {
    throw new Error('معرف المنتج (SKU) مطلوب.');
  }
  if (!input.categoryId || !isInt(input.categoryId) || input.categoryId <= 0) {
    throw new Error('القسم مطلوب.');
  }
  if (!isInt(input.purchasePrice) || input.purchasePrice < 0) {
    throw new Error('سعر الشراء يجب أن يكون عددا صحيحا أكبر أو يساوي صفر.');
  }
  if (!isInt(input.salePrice) || input.salePrice < 0) {
    throw new Error('سعر البيع يجب أن يكون عددا صحيحا أكبر أو يساوي صفر.');
  }
  if (isNew) {
    const q = input.quantity ?? 0;
    if (!isInt(q) || q < 0) {
      throw new Error('الكمية يجب أن تكون عددا صحيحا أكبر أو يساوي صفر.');
    }
  }
  if (input.lowStockThreshold !== undefined) {
    if (!isInt(input.lowStockThreshold) || input.lowStockThreshold < 0) {
      throw new Error('حد التنبيه يجب أن يكون عددا صحيحا أكبر أو يساوي صفر.');
    }
  }
}


/** Throw if another product already owns this SKU (UNIQUE constraint is global). */
async function requireSkuFree(tx: DbAdapter, sku: string, exceptId?: number): Promise<void> {
  const rows = exceptId
    ? await tx.query<{ id: number }>(
        'SELECT id FROM products WHERE sku = ? AND id != ? LIMIT 1',
        [sku, exceptId],
      )
    : await tx.query<{ id: number }>(
        'SELECT id FROM products WHERE sku = ? LIMIT 1',
        [sku],
      );
  if (rows.length > 0) {
    throw new Error(`المعرف "${sku}" مستعمل من قبل. منتج آخر يملك نفس المعرف.`);
  }
}

// ===== Queries =====

export async function getProducts(
  db: DbAdapter,
  filters: ProductFilters = {},
): Promise<Product[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!filters.includeInactive) where.push('p.is_active = 1');

  if (filters.categoryId) {
    where.push('p.category_id = ?');
    params.push(filters.categoryId);
  }

  const search = (filters.search ?? '').trim().toLowerCase();
  if (search) {
    where.push('(LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ? OR LOWER(IFNULL(p.color, \'\')) LIKE ? OR LOWER(IFNULL(p.material, \'\')) LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const sql =
    PRODUCT_SELECT +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY p.id DESC';
  const rows = await db.query<Product & { category_name?: string }>(sql, params);
  return rows.map(mapRow);
}

/** By default only active products; pass includeInactive to fetch soft-deleted ones. */
export async function getProductById(db: DbAdapter, id: number, includeInactive = false): Promise<Product | null> {
  const rows = await db.query<Product & { category_name?: string }>(
    `${PRODUCT_SELECT} WHERE p.id = ?${includeInactive ? '' : ' AND p.is_active = 1'}`,
    [id],
  );
  return rows.length ? mapRow(rows[0]) : null;
}

/**
 * Automatic unique SKU like "CAT1-0001" (category id + sequential number).
 * The caller may override the value in the form.
 */
export async function generateSku(db: DbAdapter, categoryId: number): Promise<string> {
  const prefix = `CAT${categoryId}-`;
  const rows = await db.query<{ max_sku: string | null }>(
    `SELECT MAX(sku) AS max_sku FROM products WHERE sku LIKE ?`,
    [`${prefix}%`],
  );
  let next = 1;
  const max = rows[0]?.max_sku;
  if (max) {
    const n = parseInt(max.slice(prefix.length), 10);
    if (Number.isFinite(n)) next = n + 1;
  }
  // Safety loop: skip any collision (e.g. manually typed SKUs).
  let candidate = `${prefix}${String(next).padStart(4, '0')}`;
  while (true) {
    const exists = await db.query<{ c: number }>(
      'SELECT COUNT(*) AS c FROM products WHERE sku = ?',
      [candidate],
    );
    if ((exists[0]?.c ?? 0) === 0) return candidate;
    next += 1;
    candidate = `${prefix}${String(next).padStart(4, '0')}`;
  }
}

/**
 * Existing ACTIVE products with the same normalized name + category +
 * size + color + material (null and empty treated as equal).
 */
export async function findSimilarProducts(
  db: DbAdapter,
  criteria: { name: string; categoryId: number; size?: string | null; color?: string | null; material?: string | null },
): Promise<Product[]> {
  const all = await db.query<Product & { category_name?: string }>(
    `${PRODUCT_SELECT} WHERE p.is_active = 1 AND p.category_id = ?`,
    [criteria.categoryId],
  );
  const target = normalizeName(criteria.name);
  return all
    .map(mapRow)
    .filter(
      (p) =>
        normalizeName(p.name) === target &&
        sameOptional(p.size, criteria.size) &&
        sameOptional(p.color, criteria.color) &&
        sameOptional(p.material, criteria.material),
    );
}

// ===== Mutations =====

/**
 * Create a product inside ONE transaction:
 * insert the product, and if quantity > 0 insert an 'initial'
 * stock_movements row (note: 'رصيد أولي'). Duplicate SKU -> Arabic error,
 * no partial rows left (rollback).
 */
export async function createProduct(db: DbAdapter, input: ProductInput): Promise<Product> {
  validateProductInput(input, true);
  const quantity = input.quantity ?? 0;
  const threshold = input.lowStockThreshold ?? 5;

  const newId = await db.transaction(async (tx) => {
    await requireSkuFree(tx, input.sku.trim());
    let res;
    try {
      res = await tx.execute(
        `INSERT INTO products
           (sku, name, category_id, size, color, material,
            purchase_price, sale_price, quantity, low_stock_threshold, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          input.sku.trim(),
          input.name.trim(),
          input.categoryId,
          input.size?.trim() || null,
          input.color?.trim() || null,
          input.material?.trim() || null,
          input.purchasePrice,
          input.salePrice,
          quantity,
          threshold,
        ],
      );
    } catch (err) {
      const msg = String(err);
      if (msg.includes('UNIQUE')) {
        throw new Error(`المعرف "${input.sku.trim()}" مستعمل من قبل. منتج آخر يملك نفس المعرف.`);
      }
      if (msg.includes('FOREIGN KEY')) {
        throw new Error('القسم المحدد غير موجود.');
      }
      throw err;
    }
    const id = res.lastInsertId!;
    if (quantity > 0) {
      await tx.execute(
        `INSERT INTO stock_movements (product_id, type, quantity_change, quantity_after, note)
         VALUES (?, 'initial', ?, ?, 'رصيد أولي')`,
        [id, quantity, quantity],
      );
    }
    return id;
  });

  return (await getProductById(db, newId))!;
}

/**
 * Update product fields (NOT quantity — quantity changes only through
 * stock movements). Updates updated_at.
 */
export async function updateProduct(
  db: DbAdapter,
  id: number,
  input: Omit<ProductInput, 'quantity'>,
): Promise<Product> {
  validateProductInput({ ...input, quantity: 0 }, false);

  const existing = await getProductById(db, id);
  if (!existing) throw new Error('المنتج غير موجود.');

  await db.transaction(async (tx) => {
    try {
      await requireSkuFree(tx, input.sku.trim(), id);
      await tx.execute(
        `UPDATE products SET
           sku = ?, name = ?, category_id = ?, size = ?, color = ?, material = ?,
           purchase_price = ?, sale_price = ?, low_stock_threshold = ?,
           updated_at = datetime('now','localtime')
         WHERE id = ?`,
        [
          input.sku.trim(),
          input.name.trim(),
          input.categoryId,
          input.size?.trim() || null,
          input.color?.trim() || null,
          input.material?.trim() || null,
          input.purchasePrice,
          input.salePrice,
          input.lowStockThreshold ?? existing.low_stock_threshold,
          id,
        ],
      );
    } catch (err) {
      const msg = String(err);
      if (msg.includes('UNIQUE')) {
        throw new Error(`المعرف "${input.sku.trim()}" مستعمل من قبل. منتج آخر يملك نفس المعرف.`);
      }
      throw err;
    }
  });

  return (await getProductById(db, id))!;
}

/**
 * Delete a product.
 * - If it has movements other than 'initial' or any sale_items -> SOFT
 *   delete (is_active = 0) with a friendly Arabic message.
 * - Otherwise hard delete (its 'initial' movement is removed too).
 */
export async function deleteProduct(
  db: DbAdapter,
  id: number,
): Promise<{ softDeleted: boolean; message: string }> {
  const product = await getProductById(db, id);
  if (!product) throw new Error('المنتج غير موجود.');

  const [otherMov, sales] = await Promise.all([
    db.query<{ c: number }>(
      `SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ? AND type != 'initial'`,
      [id],
    ),
    db.query<{ c: number }>(
      'SELECT COUNT(*) AS c FROM sale_items WHERE product_id = ?',
      [id],
    ),
  ]);
  const hasHistory = (otherMov[0]?.c ?? 0) > 0 || (sales[0]?.c ?? 0) > 0;

  if (hasHistory) {
    await db.execute('UPDATE products SET is_active = 0, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?', [id]);
    return {
      softDeleted: true,
      message: `تم إخفاء المنتج "${product.name}" لأنه يملك سجل حركات أو مبيعات (حذف ناعم). يمكنك إظهاره من خيار "إظهار المحذوفة".`,
    };
  }

  await db.transaction(async (tx) => {
    await tx.execute("DELETE FROM stock_movements WHERE product_id = ? AND type = 'initial'", [id]);
    await tx.execute('DELETE FROM products WHERE id = ?', [id]);
  });
  return {
    softDeleted: false,
    message: `تم حذف المنتج "${product.name}" نهائيا مع رصيده الأولي.`,
  };
}

/** Re-activate a softly deleted product. */
export async function restoreProduct(db: DbAdapter, id: number): Promise<void> {
  const product = await getProductById(db, id, true);
  if (!product) throw new Error('المنتج غير موجود.');
  await db.execute(
    "UPDATE products SET is_active = 1, updated_at = datetime('now','localtime') WHERE id = ?",
    [id],
  );
}
