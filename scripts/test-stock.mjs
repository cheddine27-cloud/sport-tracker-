// ===== Automated tests for the stock service (src/services/stock.ts) =====
// In-memory better-sqlite3 + REAL migrations, same pattern as test-products.mjs.

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
function ok(name) { console.log(`PASS  ${name}`); passed++; }
function fail(name, err) { console.log(`FAIL  ${name}\n      -> ${err?.message ?? err}`); failed++; }
async function checkAsync(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${b}, got ${a}`); }

// Strip Arabic diacritics (U+064B..U+0652) so comparisons are robust.
function stripArabicDiacritics(s) { return String(s).replace(/[\u064B-\u0652]/g, ''); }

async function expectReject(promiseFactory, msgPart, label) {
  let threw = null;
  try { await promiseFactory(); } catch (e) { threw = e; }
  assert(threw, `${label}: expected rejection but it resolved`);
  const actual = stripArabicDiacritics(String(threw.message ?? threw));
  assert(actual.includes(stripArabicDiacritics(msgPart)), `${label}: error "${threw.message}" should contain "${msgPart}"`);
}

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(path.join(ROOT, 'src-tauri/migrations/001_schema.sql'), 'utf8'));
  db.exec(readFileSync(path.join(ROOT, 'src-tauri/migrations/002_seed.sql'), 'utf8'));
  return db;
}

/** DbAdapter over better-sqlite3 — serialized transactions (like appDb). */
function makeAdapter(db) {
  let queue = Promise.resolve();
  const runSerialized = (fn) => { const p = queue.then(fn, fn); queue = p.then(() => {}, () => {}); return p; };
  const mkTx = () => ({
    async query(sql, params = []) { return db.prepare(sql).all(...params); },
    async execute(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) };
    },
    transaction(fn) { return fn(this); },
  });
  const adapter = {
    async query(sql, params = []) { return db.prepare(sql).all(...params); },
    async execute(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) };
    },
    async transaction(fn) {
      return runSerialized(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(mkTx());
          db.exec('COMMIT');
          return result;
        } catch (err) { db.exec('ROLLBACK'); throw err; }
      });
    },
  };
  return adapter;
}

async function main() {
  const S = await import(pathToFileURL(path.join(ROOT, 'src/services/stock.ts')).href);
  const P = await import(pathToFileURL(path.join(ROOT, 'src/services/products.ts')).href);

  const mk = async () => {
    const db = freshDb();
    const adapter = makeAdapter(db);
    const p = await P.createProduct(adapter, {
      sku: 'T-001', name: 'صفارة', categoryId: 2,
      purchasePrice: 200, salePrice: 300, quantity: 100, lowStockThreshold: 5,
    });
    return { db, adapter, product: p };
  };

  // ---------- 1. restock 100 + 50 = 150 ----------
  {
    const { db, adapter, product } = await mk();
    await checkAsync('1. restock 50 on qty 100 -> 150 with correct movement', async () => {
      const r = await S.restockProduct(adapter, { productId: product.id, quantity: 50 });
      assertEqual(r.quantityAfter, 150, 'quantityAfter');
      const q = db.prepare('SELECT quantity FROM products WHERE id=?').get(product.id).quantity;
      assertEqual(q, 150, 'products.quantity');
      const m = db.prepare(`SELECT * FROM stock_movements WHERE product_id=? AND type='restock'`).get(product.id);
      assertEqual(m.quantity_change, 50, 'movement change');
      assertEqual(m.quantity_after, 150, 'movement after');
    });
  }

  // ---------- 2. restock with/without newPurchasePrice ----------
  {
    const { db, adapter, product } = await mk();
    await checkAsync('2. restock updates purchase price and notes it; keeps it otherwise', async () => {
      await S.restockProduct(adapter, { productId: product.id, quantity: 10 });
      let price = db.prepare('SELECT purchase_price FROM products WHERE id=?').get(product.id).purchase_price;
      assertEqual(price, 200, 'price unchanged without newPurchasePrice');
      await S.restockProduct(adapter, { productId: product.id, quantity: 5, newPurchasePrice: 250 });
      price = db.prepare('SELECT purchase_price FROM products WHERE id=?').get(product.id).purchase_price;
      assertEqual(price, 250, 'price updated');
      const note = db.prepare(`SELECT note FROM stock_movements WHERE product_id=? AND type='restock' ORDER BY id DESC LIMIT 1`).get(product.id).note;
      assert(stripArabicDiacritics(note).includes(stripArabicDiacritics('تحديث سعر الشراء من 200 إلى 250')), `note should mention price change, got: ${note}`);
    });
  }

  // ---------- 3. invalid quantities rejected, nothing changed ----------
  {
    const { db, adapter, product } = await mk();
    await checkAsync('3. restock qty 0 / negative / decimal rejected in Arabic; nothing changed', async () => {
      for (const bad of [0, -5, 2.5]) {
        await expectReject(() => S.restockProduct(adapter, { productId: product.id, quantity: bad }), 'الكمية', `qty=${bad}`);
      }
      const q = db.prepare('SELECT quantity FROM products WHERE id=?').get(product.id).quantity;
      assertEqual(q, 100, 'quantity untouched');
      const n = db.prepare('SELECT COUNT(*) c FROM stock_movements WHERE product_id=?').get(product.id).c;
      assertEqual(n, 1, 'no extra movements');
    });
  }

  // ---------- 4. decreaseStock 5 from 20 -> 15 ----------
  {
    const { adapter, product } = await mk();
    await checkAsync('4. decreaseStock 5 -> movement -5, quantity_after correct', async () => {
      await adapter.transaction(async (tx) => { await tx.execute('UPDATE products SET quantity = 20 WHERE id = ?', [product.id]); });
      const r = await adapter.transaction((tx) => S.decreaseStock(tx, { productId: product.id, quantity: 5, type: 'sale_store' }));
      assertEqual(r.quantityAfter, 15, 'quantityAfter');
      const m = await adapter.query(`SELECT * FROM stock_movements WHERE product_id=? AND type='sale_store'`, [product.id]);
      assertEqual(m[0].quantity_change, -5, 'change');
      assertEqual(m[0].quantity_after, 15, 'after');
    });
  }

  // ---------- 5. decrease more than available ----------
  {
    const { db, adapter, product } = await mk();
    await checkAsync('5. decreaseStock beyond stock -> Arabic error with available qty; unchanged; no movement', async () => {
      await expectReject(() => adapter.transaction((tx) => S.decreaseStock(tx, { productId: product.id, quantity: 150, type: 'sale_store' })), 'هي 100 فقط', 'over-decrease');
      const q = db.prepare('SELECT quantity FROM products WHERE id=?').get(product.id).quantity;
      assertEqual(q, 100, 'quantity unchanged');
      const n = db.prepare(`SELECT COUNT(*) c FROM stock_movements WHERE product_id=? AND type='sale_store'`).get(product.id).c;
      assertEqual(n, 0, 'no movement written');
    });
  }

  // ---------- 6. decrease on inactive product ----------
  {
    const { adapter, product } = await mk();
    await checkAsync('6. decreaseStock on inactive product -> rejected', async () => {
      await adapter.transaction(async (tx) => { await tx.execute('UPDATE products SET is_active = 0 WHERE id = ?', [product.id]); });
      await expectReject(() => adapter.transaction((tx) => S.decreaseStock(tx, { productId: product.id, quantity: 1, type: 'sale_store' })), 'محذوف', 'inactive');
    });
  }

  // ---------- 7. restockMany all-or-nothing ----------
  {
    const { db, adapter, product } = await mk();
    await checkAsync('7. restockMany with one invalid line -> full rollback', async () => {
      const p2 = await P.createProduct(adapter, { sku: 'T-002', name: 'بالون', categoryId: 2, purchasePrice: 300, salePrice: 450, quantity: 10 });
      const before1 = db.prepare('SELECT quantity FROM products WHERE id=?').get(product.id).quantity;
      await expectReject(
        () => S.restockMany(adapter, [
          { productId: product.id, quantity: 20 },
          { productId: p2.id, quantity: -3 },
        ]), 'الكمية', 'restockMany invalid');
      const after1 = db.prepare('SELECT quantity FROM products WHERE id=?').get(product.id).quantity;
      const after2 = db.prepare('SELECT quantity FROM products WHERE id=?').get(p2.id).quantity;
      assertEqual(after1, before1, 'line 1 rolled back');
      assertEqual(after2, 10, 'line 2 untouched');
      const n = db.prepare(`SELECT COUNT(*) c FROM stock_movements WHERE type='restock'`).get().c;
      assertEqual(n, 0, 'no restock movements after rollback');
    });
  }

  // ---------- 8. adjustStock ----------
  {
    const { db, adapter, product } = await mk();
    await checkAsync('8. adjustStock down/up write signed movements; same qty no movement; empty reason rejected', async () => {
      const r1 = await S.adjustStock(adapter, { productId: product.id, newQuantity: 90, reason: 'تلف' });
      assert(r1.changed, 'should change');
      const m1 = db.prepare(`SELECT * FROM stock_movements WHERE type='adjustment' ORDER BY id DESC LIMIT 1`).get();
      assertEqual(m1.quantity_change, -10, 'negative adjustment');
      assertEqual(m1.quantity_after, 90, 'after');
      const r2 = await S.adjustStock(adapter, { productId: product.id, newQuantity: 120, reason: 'زيادة جرد' });
      assert(r2.changed, 'should change up');
      const m2 = db.prepare(`SELECT * FROM stock_movements WHERE type='adjustment' ORDER BY id DESC LIMIT 1`).get();
      assertEqual(m2.quantity_change, 30, 'positive adjustment');
      const r3 = await S.adjustStock(adapter, { productId: product.id, newQuantity: 120, reason: 'لا شيء' });
      assert(!r3.changed, 'same number -> no change');
      const n = db.prepare(`SELECT COUNT(*) c FROM stock_movements WHERE type='adjustment'`).get().c;
      assertEqual(n, 2, 'only two adjustment movements');
      await expectReject(() => S.adjustStock(adapter, { productId: product.id, newQuantity: 5, reason: '   ' }), 'السبب مطلوب', 'empty reason');
    });
  }

  // ---------- 9. getInventorySummary exact numbers ----------
  {
    const { adapter, product } = await mk();
    await checkAsync('9. summary: 10x200=2000 then after decrease of 2 -> 8x200=1600', async () => {
      await adapter.transaction(async (tx) => {
        await tx.execute('UPDATE products SET quantity = 10 WHERE id = ?', [product.id]);
        await tx.execute(`INSERT INTO stock_movements (product_id, type, quantity_change, quantity_after, note) VALUES (?, 'adjustment', -90, 10, 'ضبط للاختبار')`, [product.id]);
      });
      let s = await S.getInventorySummary(adapter);
      assertEqual(s.stockValueAtCost, 2000, 'value at cost');
      assertEqual(s.totalUnits, 10, 'units');
      assertEqual(s.stockValueAtSale, 3000, 'value at sale');
      assertEqual(s.expectedProfit, 1000, 'expected profit');
      await adapter.transaction((tx) => S.decreaseStock(tx, { productId: product.id, quantity: 2, type: 'sale_store' }));
      s = await S.getInventorySummary(adapter);
      assertEqual(s.stockValueAtCost, 1600, 'value at cost after sale');
      assertEqual(s.totalUnits, 8, 'units after sale');
    });
  }

  // ---------- 10. getStockMovements filters ----------
  {
    const { adapter, product } = await mk();
    await checkAsync('10. movements: newest first, filter by product/type/date range', async () => {
      await S.restockProduct(adapter, { productId: product.id, quantity: 10 });
      await S.restockProduct(adapter, { productId: product.id, quantity: 20 });
      const all = await S.getStockMovements(adapter, {});
      assertEqual(all.length, 3, 'three movements');
      assert(all[0].id > all[1].id && all[1].id > all[2].id, 'newest first');
      const onlyRestock = await S.getStockMovements(adapter, { type: 'restock' });
      assertEqual(onlyRestock.length, 2, 'type filter');
      const p2 = await P.createProduct(adapter, { sku: 'T-002', name: 'بالون', categoryId: 2, purchasePrice: 300, salePrice: 450, quantity: 5 });
      const byProduct = await S.getStockMovements(adapter, { productId: p2.id });
      assertEqual(byProduct.length, 1, 'product filter');
      assertEqual(byProduct[0].product_name, 'بالون', 'joined name');
      assertEqual(byProduct[0].product_sku, 'T-002', 'joined sku');
      const future = await S.getStockMovements(adapter, { dateFrom: '2999-01-01' });
      assertEqual(future.length, 0, 'date range filter');
      const today = await S.getStockMovements(adapter, { dateFrom: '2000-01-01', dateTo: '2999-12-31' });
      assertEqual(today.length, 4, 'inclusive range returns all');
      const page = await S.getStockMovements(adapter, { limit: 2, offset: 1 });
      assertEqual(page.length, 2, 'limit/offset');
    });
  }

  // ---------- 11. verifyStockIntegrity ----------
  {
    const { db, adapter, product } = await mk();
    await checkAsync('11. integrity empty after 200 random ops; detects manual corruption', async () => {
      // deterministic PRNG (fixed seed)
      let seed = 42;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      for (let i = 0; i < 200; i++) {
        const q = 1 + Math.floor(rnd() * 5);
        if (rnd() < 0.5) {
          await S.restockProduct(adapter, { productId: product.id, quantity: q });
        } else {
          try { await adapter.transaction((tx) => S.decreaseStock(tx, { productId: product.id, quantity: q, type: 'sale_store' })); } catch { /* may run out of stock */ }
        }
      }
      const clean = await S.verifyStockIntegrity(adapter);
      assertEqual(clean.length, 0, 'integrity must hold after 200 ops');
      // corrupt directly (bypassing the service)
      db.prepare('UPDATE products SET quantity = quantity + 7 WHERE id=?').run(product.id);
      const bad = await S.verifyStockIntegrity(adapter);
      assertEqual(bad.length, 1, 'corruption detected');
      assertEqual(bad[0].productId, product.id, 'correct product flagged');
    });
  }

  // ---------- 12. concurrency ----------
  {
    const { db, adapter, product } = await mk();
    await checkAsync('12. 10 parallel decreaseStock(3) on qty 20 -> 6 ok, 4 fail, final 2, integrity holds', async () => {
      await adapter.transaction(async (tx) => {
        await tx.execute('UPDATE products SET quantity = 20 WHERE id = ?', [product.id]);
        await tx.execute(`INSERT INTO stock_movements (product_id, type, quantity_change, quantity_after, note) VALUES (?, 'adjustment', -80, 20, 'ضبط للاختبار')`, [product.id]);
      });
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => adapter.transaction((tx) => S.decreaseStock(tx, { productId: product.id, quantity: 3, type: 'sale_store' }))),
      );
      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected').length;
      assertEqual(fulfilled, 6, 'succeeded count');
      assertEqual(rejected, 4, 'failed count');
      const q = db.prepare('SELECT quantity FROM products WHERE id=?').get(product.id).quantity;
      assertEqual(q, 2, 'final quantity');
      const bad = await S.verifyStockIntegrity(adapter);
      assertEqual(bad.length, 0, 'integrity holds');
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
