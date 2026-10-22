// ===== Database access layer shared between the Tauri app and Node tests =====

import type { Category } from '@/types';

/** Result of an INSERT/UPDATE/DELETE. */
export interface ExecuteResult {
  rowsAffected: number;
  lastInsertId?: number;
}

/**
 * Minimal adapter interface every service depends on.
 * - The production implementation wraps `src/lib/db.ts` (tauri-plugin-sql).
 * - The test implementation (`scripts/test-products.mjs`) wraps better-sqlite3.
 */
export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

// ---- Small SQL helpers used by the services (pure, adapter-agnostic) ----

/** Normalize a product name for "similar product" matching. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Treat null / undefined / empty-string as equal when comparing optional fields. */
export function sameOptional(a?: string | null, b?: string | null): boolean {
  const na = (a ?? '').toString().trim().toLowerCase();
  const nb = (b ?? '').toString().trim().toLowerCase();
  return na === nb;
}

/** Categories ordered by id (used by products UI filters/tabs). */
export async function listCategories(db: DbAdapter): Promise<Category[]> {
  return db.query<Category>('SELECT * FROM categories ORDER BY id');
}
