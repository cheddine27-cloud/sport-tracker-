// ===== Automated tests for the sales service (src/services/sales.ts) =====
// In-memory better-sqlite3 + REAL migrations, same pattern as test-stock.mjs.

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
  const SA = await import(pathToFileURL(path.join(ROOT, 'src/services/sales.ts')).href);

  const mk = async () => {
    const db = freshDb();
    const adapter = makeAdapter(db);
    const whistle = await P.createProduct(adapter, {
      sku: 'W-001', name: 'صفارة', categoryId: 2,
      purchasePrice: 200, salePrice: 300, quantity: 20, lowStockThreshold: 5,
    });
    const jersey = await P.createProduct(adapter, {
      sku: 'J-001', name: 'تي شيرت', categoryId: 1,
      purchasePrice: 1500, salePrice: 2200, quantity: 10, lowStockThreshold: 3,
    });
    return { db, adapter, whistle, jersey };
  };
  const qtyOf = (db, id) => db.prepare('SELECT quantity FROM products WHERE id=?').get(id).quantity;

  // ---------- 1. core scenario ----------
  {
    const { db, adapter, whistle } = await mk();
    await checkAsync('1. sell 5 of 20 -> qty 15, one sale_store -5 movement with referenceId', async () => {
      const r = await SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 5 }] });
      assertEqual(qtyOf(db, whistle.id), 15, 'quantity');
      assertEqual(r.total, 1500, 'total');
      assertEqual(r.profit, 500, 'profit');
      const mv = db.prepare("SELECT * FROM stock_movements WHERE product_id=? AND type='sale_store'").all(whistle.id);
      assertEqual(mv.length, 1, 'movement count');
      assertEqual(mv[0].quantity_change, -5, 'change');
      assertEqual(mv[0].quantity_after, 15, 'after');
      assertEqual(mv[0].reference_id, r.saleId, 'referenceId');
    });
  }

  // ---------- 2. two products exact math ----------
  {
    const { db, adapter, whistle, jersey } = await mk();
    await checkAsync('2. two-product sale: totals exact (whistle 200/300, jersey 1500/2200)', async () => {
      const r = await SA.createStoreSale(adapter, {
        items: [{ productId: whistle.id, quantity: 2 }, { productId: jersey.id, quantity: 3 }],
      });
      assertEqual(r.subtotal, 2 * 300 + 3 * 2200, 'subtotal'); // 7200
      assertEqual(r.cost, 2 * 200 + 3 * 1500, 'cost');         // 4900
      assertEqual(r.total, 7200, 'total');
      assertEqual(r.profit, 2300, 'profit');
      assertEqual(qtyOf(db, whistle.id), 18, 'whistle qty');
      assertEqual(qtyOf(db, jersey.id), 7, 'jersey qty');
    });
  }

  // ---------- 3. second line lacks stock -> all-or-nothing ----------
  {
    const { db, adapter, whistle, jersey } = await mk();
    await checkAsync('3. insufficient stock on 2nd line -> nothing saved, Arabic error with available qty', async () => {
      await expectReject(
        () => SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 2 }, { productId: jersey.id, quantity: 999 }] }),
        'الكمية المتوفرة من (تي شيرت) هي 10 فقط', 'overdraw');
      assertEqual(qtyOf(db, whistle.id), 20, 'whistle unchanged');
      assertEqual(db.prepare('SELECT COUNT(*) c FROM sales').get().c, 0, 'no sale row');
      assertEqual(db.prepare('SELECT COUNT(*) c FROM sale_items').get().c, 0, 'no items');
      assertEqual(db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE type='sale_store'").get().c, 0, 'no movements');
    });
  }

  // ---------- 4. unit price override ----------
  {
    const { db, adapter, whistle } = await mk();
    await checkAsync('4. override unit price: sale uses it, purchase snapshot stays product price', async () => {
      const r = await SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 2, unitPrice: 350 }] });
      assertEqual(r.total, 700, 'total');
      assertEqual(r.cost, 400, 'cost');
      const item = db.prepare('SELECT * FROM sale_items').get();
      assertEqual(item.sale_price, 350, 'snapshot sale price');
      assertEqual(item.purchase_price, 200, 'snapshot purchase price');
    });
  }

  // ---------- 5. snapshots survive later price change ----------
  {
    const db = freshDb();
    const adapter = makeAdapter(db);
    await checkAsync('5. changing product price after sale does not change that sale totals', async () => {
      const w = await P.createProduct(adapter, { sku: 'W', name: 'صفارة', categoryId: 2, purchasePrice: 200, salePrice: 300, quantity: 10 });
      const r = await SA.createStoreSale(adapter, { items: [{ productId: w.id, quantity: 2 }] });
      db.prepare('UPDATE products SET sale_price=999 WHERE id=?').run(w.id);
      const sale = await SA.getSaleById(adapter, r.saleId);
      assertEqual(sale.total, 600, 'sale total');
      assertEqual(sale.profit, 200, 'sale profit');
    });
  }

  // ---------- 6. discount rules ----------
  {
    const { adapter, whistle } = await mk();
    await checkAsync('6. discount: total = subtotal - discount; too big / negative rejected', async () => {
      const r = await SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 3 }], discount: 100 });
      assertEqual(r.subtotal, 900, 'subtotal');
      assertEqual(r.total, 800, 'total');
      await expectReject(() => SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 1 }], discount: 500 }), 'أكبر من مجموع الفاتورة', 'big discount');
      await expectReject(() => SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 1 }], discount: -10 }), 'أكبر من أو يساوي صفر', 'negative discount');
    });
  }

  // ---------- 7. merge duplicates, bad quantities, empty cart ----------
  {
    const { db, adapter, whistle } = await mk();
    await checkAsync('7. duplicate lines merged; qty 0/negative/decimal rejected; empty cart rejected', async () => {
      const r = await SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 2 }, { productId: whistle.id, quantity: 3 }] });
      assertEqual(qtyOf(db, whistle.id), 15, 'merged qty 5 sold');
      assertEqual(db.prepare('SELECT COUNT(*) c FROM sale_items WHERE sale_id=?').all(r.saleId).length, 1, 'one line');
      await expectReject(() => SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 0 }] }), 'أكبر من صفر', 'zero');
      await expectReject(() => SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: -2 }] }), 'أكبر من صفر', 'negative');
      await expectReject(() => SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 1.5 }] }), 'عددا صحيحا', 'decimal');
      await expectReject(() => SA.createStoreSale(adapter, { items: [] }), 'السلة فارغة', 'empty');
    });
  }

  // ---------- 8. cancel store sale ----------
  {
    const { db, adapter, whistle } = await mk();
    await checkAsync('8. cancelStoreSale restores +5 return movement, excluded from summary; double-cancel & wrong-type rejected', async () => {
      const r = await SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 5 }] });
      await SA.cancelStoreSale(adapter, r.saleId);
      assertEqual(qtyOf(db, whistle.id), 20, 'restored');
      const mv = db.prepare("SELECT * FROM stock_movements WHERE type='return'").all();
      assertEqual(mv.length, 1, 'return movement');
      assertEqual(mv[0].quantity_change, 5, '+5');
      assertEqual(mv[0].reference_id, r.saleId, 'ref');
      const sum = await SA.getSalesSummary(adapter);
      assertEqual(sum.revenue, 0, 'excluded revenue');
      assertEqual(sum.profit, 0, 'excluded profit');
      await expectReject(() => SA.cancelStoreSale(adapter, r.saleId), 'ملغاة مسبقا', 'double cancel');
      const o = await SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 1 }], customerName: 'زبون', customerPhone: '0555123456' });
      await expectReject(() => SA.cancelStoreSale(adapter, o.saleId), 'خاص بمبيعات المحل', 'cancel outside via store');
    });
  }

  // ---------- 9. summary exact numbers + date filter ----------
  {
    const db = freshDb();
    const adapter = makeAdapter(db);
    await checkAsync('9. getSalesSummary exact numbers after several sales (some cancelled)', async () => {
      const w = await P.createProduct(adapter, { sku: 'W', name: 'صفارة', categoryId: 2, purchasePrice: 200, salePrice: 300, quantity: 100 });
      const a = await SA.createStoreSale(adapter, { items: [{ productId: w.id, quantity: 10 }] }); // 3000 / cost 2000
      await SA.createStoreSale(adapter, { items: [{ productId: w.id, quantity: 5 }] });            // 1500 / 1000
      await SA.cancelStoreSale(adapter, a.saleId);                                                 // excluded
      const s = await SA.getSalesSummary(adapter);
      assertEqual(s.salesCount, 1, 'confirmed count');
      assertEqual(s.revenue, 1500, 'revenue');
      assertEqual(s.cost, 1000, 'cost');
      assertEqual(s.profit, 500, 'profit');
      assertEqual(s.unitsSold, 5, 'units');
      const future = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
      const s2 = await SA.getSalesSummary(adapter, { dateFrom: future });
      assertEqual(s2.salesCount, 0, 'date filter excludes past');
    });
  }

  // ---------- 10. inactive product cannot be sold ----------
  {
    const { adapter, whistle } = await mk();
    await checkAsync('10. soft-deleted product cannot be sold', async () => {
      // Give the product a non-initial movement so deleteProduct does a SOFT delete (row stays with is_active=0).
      await S.restockProduct(adapter, { productId: whistle.id, quantity: 5 });
      const res = await P.deleteProduct(adapter, whistle.id);
      assert(res.softDeleted, 'expected a soft delete');
      await expectReject(() => SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 1 }] }), 'محذوف', 'inactive');
    });
  }

  // ---------- 11. concurrency ----------
  {
    const db = freshDb();
    const adapter = makeAdapter(db);
    await checkAsync('11. 10 parallel sales of 3 on qty 20 -> exactly 6 succeed, final qty 2', async () => {
      const w = await P.createProduct(adapter, { sku: 'W', name: 'صفارة', categoryId: 2, purchasePrice: 200, salePrice: 300, quantity: 20 });
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => SA.createStoreSale(adapter, { items: [{ productId: w.id, quantity: 3 }] })),
      );
      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      assertEqual(fulfilled, 6, 'successes');
      assertEqual(qtyOf(db, w.id), 2, 'final qty');
      const bad = await S.verifyStockIntegrity(adapter);
      assertEqual(bad.length, 0, 'integrity holds');
    });
  }

  // ---------- 12. random sequence integrity ----------
  {
    const db = freshDb();
    const adapter = makeAdapter(db);
    await checkAsync('12. fixed-seed random sales/cancellations keep integrity', async () => {
      let seed = 42;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      const ps = [];
      for (let i = 0; i < 4; i++) {
        ps.push(await P.createProduct(adapter, { sku: 'R' + i, name: 'منتج ' + i, categoryId: 2, purchasePrice: 100 + i, salePrice: 200 + i, quantity: 50 }));
      }
      const saleIds = [];
      for (let i = 0; i < 100; i++) {
        const p = ps[Math.floor(rnd() * ps.length)];
        const q = 1 + Math.floor(rnd() * 5);
        try { const r = await SA.createStoreSale(adapter, { items: [{ productId: p.id, quantity: q }] }); saleIds.push(r.saleId); } catch { /* expected sometimes */ }
      }
      for (let i = 0; i < 30; i++) {
        const id = saleIds[Math.floor(rnd() * saleIds.length)];
        if (id) { try { await SA.cancelStoreSale(adapter, id); } catch { /* already cancelled */ } }
      }
      const bad = await S.verifyStockIntegrity(adapter);
      assertEqual(bad.length, 0, 'integrity empty');
      for (const p of ps) {
        const row = db.prepare('SELECT SUM(quantity_change) s FROM stock_movements WHERE product_id=?').get(p.id);
        assertEqual(row.s, qtyOf(db, p.id), `sum equals qty for ${p.name}`);
      }
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
