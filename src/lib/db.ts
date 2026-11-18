import type Database from '@tauri-apps/plugin-sql';
import type { DbAdapter, ExecuteResult } from '@/services/dbAdapter';
import { browserDb } from './db-browser';

export type { DbAdapter, ExecuteResult } from '@/services/dbAdapter';
export type Tx = DbAdapter;

const DB_URL = 'sqlite:sports_store.db';
const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const DatabaseClass = (await import('@tauri-apps/plugin-sql')).default;
      const db = await DatabaseClass.load(DB_URL);
      await db.execute('PRAGMA foreign_keys = ON');
      return db;
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\?\d+/g, '?');
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (isTauri) {
    try {
      const db = await getDb();
      return await db.select<T[]>(normalizeSql(sql), params);
    } catch (e) {
      console.warn('Tauri DB query failed, fallback to browserDb:', e);
      return browserDb.query<T>(sql, params);
    }
  }
  return browserDb.query<T>(sql, params);
}

export async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<ExecuteResult> {
  if (isTauri) {
    try {
      const db = await getDb();
      const res = await db.execute(normalizeSql(sql), params);
      return { rowsAffected: res.rowsAffected, lastInsertId: res.lastInsertId ?? 0 };
    } catch (e) {
      console.warn('Tauri DB execute failed, fallback to browserDb:', e);
      return browserDb.execute(sql, params);
    }
  }
  return browserDb.execute(sql, params);
}

let txQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = txQueue.then(task, task);
  txQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function querySafe<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return enqueue(() => query<T>(sql, params));
}

export async function executeSafe(
  sql: string,
  params: unknown[] = [],
): Promise<ExecuteResult> {
  return enqueue(() => execute(sql, params));
}

export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return enqueue(async () => {
    if (!isTauri) {
      return browserDb.transaction(fn);
    }

    try {
      const db = await getDb();
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
    } catch (e) {
      console.warn('Tauri transaction failed, fallback to browserDb:', e);
      return browserDb.transaction(fn);
    }
  });
}

export const appDb: DbAdapter = {
  query: <T>(sql: string, params: unknown[] = []) => querySafe<T>(sql, params),
  execute: (sql: string, params: unknown[] = []) => executeSafe(sql, params),
  transaction: <T>(fn: (tx: DbAdapter) => Promise<T>) =>
    withTransaction((tx) => fn(tx)),
};
