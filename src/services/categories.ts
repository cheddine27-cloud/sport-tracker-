import { query, execute } from '@/lib/db';
import type { DbAdapter } from '@/services/dbAdapter';
import type { Category } from '@/types';

/**
 * Category service. Every function accepts an optional DbAdapter so it can
 * run against the Tauri database in the app and against better-sqlite3 in
 * the Node test harness (scripts/test-db.mjs / test-products.mjs).
 */

async function allCategories(db?: DbAdapter): Promise<Category[]> {
  if (db) return db.query<Category>('SELECT * FROM categories ORDER BY id');
  return query<Category>('SELECT * FROM categories ORDER BY id');
}

/** List all categories ordered by id. */
export async function getCategories(db?: DbAdapter): Promise<Category[]> {
  return allCategories(db);
}

/** Add a category (name must be unique — enforced by the schema). */
export async function addCategory(name: string, db?: DbAdapter): Promise<Category> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('اسم الفئة مطلوب.');
  }
  try {
    let id: number | undefined;
    if (db) {
      const res = await db.execute('INSERT INTO categories (name) VALUES (?)', [trimmed]);
      id = res.lastInsertId;
    } else {
      const res = await execute('INSERT INTO categories (name) VALUES (?1)', [trimmed]);
      id = res.lastInsertId;
    }
    const all = await allCategories(db);
    const created = id ? all.find((c) => c.id === id) : undefined;
    if (!created) throw new Error('تعذر إنشاء الفئة.');
    return created;
  } catch (err) {
    const msg = String(err);
    // Re-throw our own errors untouched; translate only DB UNIQUE violations.
    if (msg.includes('UNIQUE') && !msg.includes('موجودة مسبقاً')) {
      throw new Error(`الفئة "${trimmed}" موجودة مسبقاً.`);
    }
    throw err;
  }
}

/** Rename a category. */
export async function renameCategory(id: number, name: string, db?: DbAdapter): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('اسم الفئة مطلوب.');
  }
  try {
    if (db) {
      await db.execute('UPDATE categories SET name = ? WHERE id = ?', [trimmed, id]);
    } else {
      await execute('UPDATE categories SET name = ?1 WHERE id = ?2', [trimmed, id]);
    }
  } catch (err) {
    const msg = String(err);
    if (msg.includes('UNIQUE')) {
      throw new Error(`الفئة "${trimmed}" موجودة مسبقاً.`);
    }
    throw err;
  }
}

/**
 * Delete a category. Blocked (with a clear Arabic error) when products
 * still reference it.
 */
export async function deleteCategory(id: number, db?: DbAdapter): Promise<void> {
  const rows = db
    ? await db.query<{ count: number }>(
        'SELECT COUNT(*) AS count FROM products WHERE category_id = ?',
        [id],
      )
    : await query<{ count: number }>(
        'SELECT COUNT(*) AS count FROM products WHERE category_id = ?1',
        [id],
      );
  const count = rows[0]?.count ?? 0;
  if (count > 0) {
    throw new Error(
      `لا يمكن حذف الفئة لأنها تحتوي على ${count} منتج. انقل أو احذف منتجاتها أولاً.`,
    );
  }
  if (db) {
    await db.execute('DELETE FROM categories WHERE id = ?', [id]);
  } else {
    await execute('DELETE FROM categories WHERE id = ?1', [id]);
  }
}
