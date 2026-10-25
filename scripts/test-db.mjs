// ===== Test harness for the database layer (runs WITHOUT the desktop window) =====
// Uses better-sqlite3 in-memory + the REAL migration files from src-tauri/migrations/.
// Also statically verifies: Rust registration, capabilities, db.ts contract,
// and the categories service (blocked deletion with Arabic message).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL  ${name}\n      -> ${err.message}`);
    failed++;
  }
}

// ---- Load the compiled services (via tsx register if available) ----
async function loadServices() {
  // tsx is registered through "npm run test:db" (tsx scripts/test-db.mjs)
  const categories = await import(pathToFileURL(path.join(ROOT, 'src/services/categories.ts')).href);
  return { categories };
}

// ---- Fresh in-memory DB with the real migrations ----
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const m1 = readFileSync(path.join(ROOT, 'src-tauri/migrations/001_schema.sql'), 'utf8');
  const m2 = readFileSync(path.join(ROOT, 'src-tauri/migrations/002_seed.sql'), 'utf8');
  db.exec(m1);
  db.exec(m2);
  return db;
}

/** DbAdapter implementation over better-sqlite3 (same interface as appDb). */
function makeAdapter(db) {
  const adapter = {
    async query(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) };
    },
    async transaction(fn) {
      // better-sqlite3 transactions are synchronous per-connection: safe.
      let result;
      db.exec('BEGIN');
      try {
        result = await fn(adapter);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return result;
    },
  };
  return adapter;
}

async function main() {
  const { categories: catService } = await loadServices();

  // ================= static checks =================
  check('Rust: migrations.rs registers BOTH migrations via add_migrations', () => {
    const lib = readFileSync(path.join(ROOT, 'src-tauri/src/lib.rs'), 'utf8');
    assert.ok(lib.includes('tauri_plugin_sql::Builder::default()'));
    assert.ok(lib.includes('add_migrations("sqlite:sports_store.db", migrations::get_migrations())'));
    const mig = readFileSync(path.join(ROOT, 'src-tauri/src/migrations.rs'), 'utf8');
    assert.ok(mig.includes('include_str!("../migrations/001_schema.sql")'));
    assert.ok(mig.includes('include_str!("../migrations/002_seed.sql")'));
    assert.equal((mig.match(/version: 1,/g) || []).length, 1);
    assert.equal((mig.match(/version: 2,/g) || []).length, 1);
    assert.ok(mig.includes('seed_default_data'));
    assert.ok(mig.includes('create_tables'));
  });

  check('SQL files: schema contains all 8 tables + CHECK constraints + UNIQUE sku + 8 indexes', () => {
    const sql = readFileSync(path.join(ROOT, 'src-tauri/migrations/001_schema.sql'), 'utf8');
    for (const t of ['categories', 'products', 'stock_movements', 'sales', 'sale_items', 'distributors', 'expenses', 'settings']) {
      assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${t} (`), `missing table ${t}`);
    }
    assert.ok(/sku TEXT NOT NULL UNIQUE/.test(sql));
    assert.ok(sql.includes(`CHECK (quantity >= 0)`));
    assert.ok(sql.includes(`CHECK (quantity > 0)`));
    assert.ok(sql.includes(`type IN ('initial','restock','sale_store','sale_outside','adjustment','return','cancel_return')`));
    assert.ok(sql.includes(`type IN ('store','outside')`));
    assert.ok(sql.includes(`status IN ('pending','confirmed','cancelled')`));
    assert.ok(sql.includes('ON DELETE CASCADE'));
    const idxCount = (sql.match(/CREATE INDEX IF NOT EXISTS/g) || []).length;
    assert.equal(idxCount, 8, `expected 8 indexes, found ${idxCount}`);
  });

  check('SQL files: seed contains 3 categories + 2 settings', () => {
    const sql = readFileSync(path.join(ROOT, 'src-tauri/migrations/002_seed.sql'), 'utf8');
    assert.ok(sql.includes("'ملابس رياضية'"));
    assert.ok(sql.includes("'عتاد رياضي'"));
    assert.ok(sql.includes("'شبه طبي'"));
    assert.ok(sql.includes("('shop_name', 'المحل الرياضي')"));
    assert.ok(sql.includes("('currency', 'دج')"));
  });

  check('Capabilities: default.json has all sql permissions', () => {
    const caps = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri/capabilities/default.json'), 'utf8'));
    for (const p of ['sql:default', 'sql:allow-load', 'sql:allow-execute', 'sql:allow-select', 'sql:allow-close']) {
      assert.ok(caps.permissions.includes(p), `missing ${p}`);
    }
  });

  check('db.ts: exports getDb / query / execute / withTransaction + appDb adapter', () => {
    const src = readFileSync(path.join(ROOT, 'src/lib/db.ts'), 'utf8');
    assert.ok(src.includes('export function getDb'));
    assert.ok(src.includes('export async function query'));
    assert.ok(src.includes('export async function execute'));
    assert.ok(src.includes('export function withTransaction'));
    assert.ok(src.includes('export const appDb: DbAdapter'));
    // The queue must serialize plain ops too (querySafe/executeSafe used by appDb)
    assert.ok(src.includes('querySafe'));
    assert.ok(src.includes('executeSafe'));
    // PRAGMA foreign_keys applied after connecting
    assert.ok(src.includes("PRAGMA foreign_keys = ON"));
    // BEGIN / COMMIT / ROLLBACK present
    assert.ok(src.includes("'BEGIN'") && src.includes("'COMMIT'") && src.includes("'ROLLBACK'"));
  });

  // ================= runtime checks on a real SQLite db =================
  const db = freshDb();
  const adapter = makeAdapter(db);

  check('Migration applied: 8 tables exist', () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    for (const t of ['categories', 'products', 'stock_movements', 'sales', 'sale_items', 'distributors', 'expenses', 'settings']) {
      assert.ok(names.includes(t), `table ${t} missing`);
    }
  });

  check('Seed applied: exactly 3 default categories + 2 settings', () => {
    const cats = db.prepare('SELECT name FROM categories ORDER BY id').all().map((r) => r.name);
    assert.deepEqual(cats, ['ملابس رياضية', 'عتاد رياضي', 'شبه طبي']);
    const st = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
    assert.equal(st.length, 2);
    assert.ok(st.find((s) => s.key === 'shop_name' && s.value === 'المحل الرياضي'));
    assert.ok(st.find((s) => s.key === 'currency' && s.value === 'دج'));
  });

  check('Foreign keys enforced (insert product with bad category fails)', () => {
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO products (sku, name, category_id, purchase_price, sale_price, quantity)
           VALUES ('X1','x',999,0,0,0)`,
        )
        .run(),
    );
  });

  // ================= categories service (real code under test) =================
  const c1 = await catService.getCategories(adapter);
  check('categories.getCategories returns the 3 seeded categories', () => {
    assert.equal(c1.length, 3);
  });

  const added = await catService.addCategory('فئة اختبار', adapter);
  check('categories.addCategory inserts and returns the row', () => {
    assert.ok(added.id > 0);
    assert.equal(added.name, 'فئة اختبار');
  });

  await assertRejects(
    () => catService.addCategory('فئة اختبار', adapter),
    'موجودة مسبقا',
    'categories.addCategory rejects duplicate with Arabic message',
  );

  await catService.renameCategory(added.id, 'فئة اختبار معدلة', adapter);
  check('categories.renameCategory works', () => {
    const row = db.prepare('SELECT name FROM categories WHERE id = ?').get(added.id);
    assert.equal(row.name, 'فئة اختبار معدلة');
  });

  await // Add a product to category 1 first, then confirm deletion is blocked.
  db.prepare(
    `INSERT INTO products (sku, name, category_id, purchase_price, sale_price, quantity)
     VALUES ('TMP-1','منتج مؤقت',1,100,150,1)`,
  ).run();
  await assertRejects(
    () => catService.deleteCategory(1, adapter),
    'لا يمكن حذف الفئة لأنها تحتوي على 1 منتج',
    'deleteCategory blocks non-empty category with count in Arabic message',
  );
  db.prepare(`DELETE FROM stock_movements WHERE product_id IN (SELECT id FROM products WHERE sku='TMP-1')`).run();
  db.prepare(`DELETE FROM products WHERE sku='TMP-1'`).run();
  await catService.deleteCategory(added.id, adapter);
  check('categories.deleteCategory removes an empty category', () => {
    const row = db.prepare('SELECT COUNT(*) AS c FROM categories WHERE id = ?').get(added.id);
    assert.equal(row.c, 0);
  });

  // ================= transaction safety (withTransaction semantics) =================
  let txnErr = null;
  try {
    await adapter.transaction(async (tx) => {
      await tx.execute(`INSERT INTO expenses (description, amount) VALUES ('txn-test', 1)`);
      throw new Error('deliberate failure');
    });
  } catch (e) {
    txnErr = e;
  }
  check('withTransaction-style rollback: error propagates and row disappears', () => {
    assert.ok(txnErr, 'transaction should have thrown');
    const row = db.prepare(`SELECT COUNT(*) AS c FROM expenses WHERE description='txn-test'`).get();
    assert.equal(row.c, 0, 'rolled-back row must not remain');
  });

  await adapter.transaction(async (tx) => {
    await tx.execute(`INSERT INTO expenses (description, amount) VALUES ('txn-ok', 2)`);
  });
  check('withTransaction-style commit: row persists', () => {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM expenses WHERE description='txn-ok'`).get();
    assert.equal(row.c, 1);
  });

  // ---------------- summary ----------------
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

// Strip Arabic diacritics (U+064B..U+0652) so comparisons are robust.
function stripArabicDiacritics(s) {
  return String(s).replace(/[\u064B-\u0652]/g, '');
}

async function assertRejects(fn, msgPart, name) {
  let threw = null;
  try {
    await fn();
  } catch (e) {
    threw = e;
  }
  const actual = stripArabicDiacritics(String(threw?.message ?? threw ?? ''));
  const expected = stripArabicDiacritics(msgPart);
  if (!threw || !actual.includes(expected)) {
    console.log(`FAIL  ${name}\n      -> expected error containing "${msgPart}"`);
    failed++;
  } else {
    console.log(`PASS  ${name}`);
    passed++;
  }
}

main().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
