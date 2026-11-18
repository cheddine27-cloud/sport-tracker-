// Hybrid Db Adapter (Tauri SQL in desktop / In-Memory Mock DB in Chrome browser)
import type { DbAdapter, ExecuteResult } from '@/services/dbAdapter';
import { browserDb } from './db-browser';

export type { DbAdapter, ExecuteResult } from '@/services/dbAdapter';
export type Tx = DbAdapter;

const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

type TauriSqlPlugin = typeof import('@tauri-apps/plugin-sql');
type TauriDatabase = InstanceType<TauriSqlPlugin['default']>;

let tauriDbInstance: TauriDatabase | null = null;

async function getTauriDb(): Promise<TauriDatabase> {
  if (!tauriDbInstance) {
    const Database = (await import('@tauri-apps/plugin-sql')).default;
    tauriDbInstance = await Database.load('sqlite:sports_store.db');
    await tauriDbInstance.execute('PRAGMA foreign_keys = ON');
  }
  return tauriDbInstance;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\?\d+/g, '?');
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return appDb.query<T>(sql, params);
}

export async function execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
  return appDb.execute(sql, params);
}

export async function getDb(): Promise<DbAdapter> {
  return appDb;
}

export async function withTransaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
  return appDb.transaction(fn);
}

export const appDb: DbAdapter = {
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (isTauri) {
      try {
        const db = await getTauriDb();
        return await db.select(normalizeSql(sql), params);
      } catch (e) {
        console.warn('Tauri DB select failed, fallback to mock DB:', e);
        return browserDb.query<T>(sql, params);
      }
    }
    return browserDb.query<T>(sql, params);
  },

  async execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
    if (isTauri) {
      try {
        const db = await getTauriDb();
        const res = await db.execute(normalizeSql(sql), params);
        return { rowsAffected: res.rowsAffected, lastInsertId: res.lastInsertId ?? 0 };
      } catch (e) {
        console.warn('Tauri DB execute failed, fallback to mock DB:', e);
        return browserDb.execute(sql, params);
      }
    }
    return browserDb.execute(sql, params);
  },

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
};
