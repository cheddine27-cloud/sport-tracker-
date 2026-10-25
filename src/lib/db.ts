import Database from '@tauri-apps/plugin-sql';
import type { DbAdapter, ExecuteResult } from '@/services/dbAdapter';

export type { DbAdapter, ExecuteResult } from '@/services/dbAdapter';

/**
 * Database access layer (SQLite via tauri-plugin-sql).
 * The file sports_store.db lives in the app data directory and its
 * schema is created by the Rust migrations registered in
 * src-tauri/src/lib.rs (see migrations.rs).
 */

const DB_URL = 'sqlite:sports_store.db';

let dbPromise: Promise<Database> | null = null;

/**
 * Singleton connection. Loads the database once, enables foreign keys
 * (`PRAGMA foreign_keys = ON`) and returns the same instance afterwards.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load(DB_URL);
      // Enable FK enforcement on this connection (the plugin applies
      // per-connection settings) for good measure.
      await db.execute('PRAGMA foreign_keys = ON');
      return db;
    })().catch((err) => {
      // Do not cache a failed connection: allow a retry on next call.
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/**
 * tauri-plugin-sql (sqlite-rs under the hood) rejects `?1`-style numbered
 * placeholders in prepared statements — rewrite them to plain `?` so both
 * syntaxes work everywhere.
 */
function normalizeSql(sql: string): string {
  return sql.replace(/\?\d+/g, '?');
}

/** Run a SELECT and return the rows typed as T[]. */
export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(normalizeSql(sql), params);
}

/** Run an INSERT/UPDATE/DELETE (or PRAGMA) and return the affected info. */
export async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<ExecuteResult> {
  const db = await getDb();
  const res = await db.execute(normalizeSql(sql), params);
  return { rowsAffected: res.rowsAffected, lastInsertId: res.lastInsertId ?? 0 };
}

/**
 * A transaction handle exposing `query` and `execute`.
 * NOTE: these calls run while the shared queue is blocked for the whole
 * transaction, guaranteeing BEGIN / statements / COMMIT cannot interleave
 * with any other operation.
 */
export type Tx = DbAdapter;

/**
 * ─── Transaction safety with tauri-plugin-sql ────────────────────────────────
 * PROBLEM: the plugin executes every `select`/`execute` independently against
 * a *pool* of SQLite connections. A plain `BEGIN` issued from JS is bound to
 * whichever pooled connection happened to serve that call, while following
 * statements can be routed to *other* connections — which then run in
 * autocommit mode ("cannot start a transaction within a transaction" or
 * silently committed statements are typical symptoms).
 *
 * SOLUTION (safest working approach without a Rust command): serialize ALL
 * database operations through a single FIFO promise queue. While a
 * transaction is open, no other operation is allowed to interleave, so the
 * whole BEGIN → statements → COMMIT sequence runs uninterrupted against the
 * same pooled connection (with only one in-flight request the pool
 * deterministically reuses the same connection). On any error we ROLLBACK
 * and rethrow. Every public helper below goes through this queue.
 * ────────────────────────────────────────────────────────────────────────────
 */
let txQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = txQueue.then(task, task);
  // Keep the chain alive even when a task rejects.
  txQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Queued versions of the plain helpers (so they never overlap a txn). */
export async function querySafe<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return enqueue(() => query<T>(sql, params));
}

export async function executeSafe(
  sql: string,
  params: unknown[] = [],
): Promise<ExecuteResult> {
  return enqueue(() => execute(sql, params));
}

/**
 * Runs `fn` inside a serialized transaction:
 *   BEGIN; … ; COMMIT
 * with a guaranteed ROLLBACK if anything throws.
 */
export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return enqueue(async () => {
    const db = await getDb();
    // While the queue is blocked for this transaction, nested calls from
    // `fn` must run on THIS connection too — hence direct db usage and a
    // transaction() that simply reuses the same open transaction.
    const tx: DbAdapter = {
      query: <R>(sql: string, params: unknown[] = []) =>
        db.select<R[]>(normalizeSql(sql), params),
      execute: (sql: string, params: unknown[] = []) =>
        db
          .execute(normalizeSql(sql), params)
          .then((res) => ({
            rowsAffected: res.rowsAffected,
            lastInsertId: res.lastInsertId ?? 0,
          })),
      transaction: async <R>(inner: (t: DbAdapter) => Promise<R>): Promise<R> =>
        inner(tx),
    };

    await db.execute('BEGIN');
    try {
      const result = await fn(tx);
      await db.execute('COMMIT');
      return result;
    } catch (err) {
      try {
        await db.execute('ROLLBACK');
      } catch {
        // If rollback fails the txn was already aborted; ignore.
      }
      throw err;
    }
  });
}

/**
 * The production DbAdapter used by all services. It wraps the queued
 * helpers above, so service code behaves identically here and under the
 * better-sqlite3 adapter used by scripts/test-products.mjs.
 */
export const appDb: DbAdapter = {
  query: <T>(sql: string, params: unknown[] = []) => querySafe<T>(sql, params),
  execute: (sql: string, params: unknown[] = []) => executeSafe(sql, params),
  transaction: <T>(fn: (tx: DbAdapter) => Promise<T>) =>
    withTransaction((tx) => fn(tx)),
};
