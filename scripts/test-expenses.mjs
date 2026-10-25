// ===== Automated tests for expenses + per-product financials (src/services/expenses.ts) =====
// In-memory better-sqlite3 + REAL migrations, same pattern as test-exports.mjs.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let passed = 0, failed = 0;
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
function makeAdapter(db) {
  let queue = Promise.resolve();
  const runSerialized = (fn) => { const p = queue.then(fn, fn); queue = p.then(() => {}, () => {}); return p; };
  const mkTx = () => ({
    async query(sql, params = []) { return db.prepare(sql).all(...params); },
    async execute(sql, params = []) { const info = db.prepare(sql).run(...params); return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) }; },
    transaction(fn) { return fn(this); },
  });
  return {
    async query(sql, params = []) { return db.prepare(sql).all(...params); },
    async execute(sql, params = []) { const info = db.prepare(sql).run(...params); return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) }; },
    async transaction(fn) {
      return runSerialized(async () => {
        db.exec('BEGIN IMMEDIATE');
        try { const r = await fn(mkTx()); db.exec('COMMIT'); return r; }
        catch (err) { db.exec('ROLLBACK'); throw err; }
      });
    },
  };
}
function setSaleDate(db, saleId, dateStr) {
  db.prepare(`UPDATE sales SET created_at = ? WHERE id = ?`).run(dateStr, saleId);
}

const CUSTOMER = { customerName: 'زبون', customerPhone: '0555123456' };

async function main() {
  const P = await import(pathToFileURL(path.join(ROOT, 'src/services/products.ts')).href);
  const SA = await import(pathToFileURL(path.join(ROOT, 'src/services/sales.ts')).href);
  const EX = await import(pathToFileURL(path.join(ROOT, 'src/services/expenses.ts')).href);

  const mk = async () => {
    const db = freshDb();
    const adapter = makeAdapter(db);
    const cat = await adapter.query('SELECT id FROM categories ORDER BY id');
    return { db, adapter, cats: cat.map(c => c.id) };
  };

  // 1. Whistle core numbers
  await checkAsync('1. stockCost / sold metrics', async () => {
    const { adapter, cats } = await mk();
    const prod = await P.createProduct(adapter, { sku: 'W1', name: 'صفارة', categoryId: cats[0], purchasePrice: 200, salePrice: 300, quantity: 10, lowStockThreshold: 5 });
    let rows = await EX.getProductFinancials(adapter);
    let w = rows.find(r => r.name === 'صفارة');
    assertEqual(w.stockCost, 2000, 'stockCost before sale');
    assertEqual(w.soldUnits, 0);
    await SA.createStoreSale(adapter, { items: [{ productId: prod.id, quantity: 2 }] });
    rows = await EX.getProductFinancials(adapter);
    w = rows.find(r => r.name === 'صفارة');
    assertEqual(w.quantity, 8, 'quantity after sale');
    assertEqual(w.stockCost, 1600, 'stockCost after sale');
    assertEqual(w.soldUnits, 2);
    assertEqual(w.soldRevenue, 600);
    assertEqual(w.soldCost, 400);
    assertEqual(w.profit, 200);
  });

  // 2. Pending outside order lifecycle in product financials
  await checkAsync('2. pending units/profit then confirm then cancel', async () => {
    const { adapter, cats } = await mk();
    const prod = await P.createProduct(adapter, { sku: 'W2', name: 'بالون', categoryId: cats[1], purchasePrice: 800, salePrice: 1000, quantity: 20, lowStockThreshold: 5 });
    const order = await SA.createOutsideSale(adapter, { items: [{ productId: prod.id, quantity: 5 }], ...CUSTOMER });
    let w = (await EX.getProductFinancials(adapter)).find(r => r.sku === 'W2');
    assertEqual(w.soldUnits, 0, 'pending not counted in sold');
    assertEqual(w.soldRevenue, 0);
    assertEqual(w.pendingUnits, 5);
    assertEqual(w.pendingExpectedProfit, order.total - order.cost);
    await SA.confirmOutsideSale(adapter, order.saleId);
    w = (await EX.getProductFinancials(adapter)).find(r => r.sku === 'W2');
    assertEqual(w.soldUnits, 5, 'confirmed counted');
    assertEqual(w.pendingUnits, 0);
    assertEqual(w.profit, 5 * 200);
    // now a second order then cancel
    const o2 = await SA.createOutsideSale(adapter, { items: [{ productId: prod.id, quantity: 3 }], ...CUSTOMER });
    await SA.cancelOutsideSale(adapter, o2.saleId);
    w = (await EX.getProductFinancials(adapter)).find(r => r.sku === 'W2');
    assertEqual(w.pendingUnits, 0, 'cancelled excluded everywhere');
    assertEqual(w.soldUnits, 5, 'sold unchanged by cancel');
  });

  // 3. Discount allocation exactness with odd discount 101
  await checkAsync('3. discount 101 allocated exactly across 2 lines', async () => {
    const { adapter, cats } = await mk();
    const a = await P.createProduct(adapter, { sku: 'A', name: 'منتج أ', categoryId: cats[0], purchasePrice: 100, salePrice: 300, quantity: 10, lowStockThreshold: 5 });
    const b = await P.createProduct(adapter, { sku: 'B', name: 'منتج ب', categoryId: cats[0], purchasePrice: 50, salePrice: 700, quantity: 10, lowStockThreshold: 5 });
    // subtotal = 3*300 + 1*700 = 1600 ; discount 101 -> total 1499
    const sale = await SA.createStoreSale(adapter, { items: [{ productId: a.id, quantity: 3 }, { productId: b.id, quantity: 1 }], discount: 101 });
    assertEqual(sale.total, 1499);
    const rows = await EX.getProductFinancials(adapter);
    const ra = rows.find(r => r.sku === 'A'), rb = rows.find(r => r.sku === 'B');
    assertEqual(ra.soldRevenue + rb.soldRevenue, 1499, 'sum of per-product revenue == sale total');
    // proportional: A share floor(900*101/1600)=56 -> 844 ; B gets remainder -> 655
    assertEqual(ra.soldRevenue, 844);
    assertEqual(rb.soldRevenue, 655);
    assertEqual(ra.profit + rb.profit, sale.profit);
  });

  // 4. Price changes after sale don't alter past profit
  await checkAsync('4. price snapshot isolation', async () => {
    const { adapter, cats } = await mk();
    const prod = await P.createProduct(adapter, { sku: 'P4', name: 'سيرفات', categoryId: cats[0], purchasePrice: 200, salePrice: 300, quantity: 10, lowStockThreshold: 5 });
    const sale = await SA.createStoreSale(adapter, { items: [{ productId: prod.id, quantity: 2 }] });
    await P.updateProduct(adapter, prod.id, { name: 'سيرفات', categoryId: cats[0], sku: 'P4', purchasePrice: 999, salePrice: 1500 });
    const w = (await EX.getProductFinancials(adapter)).find(r => r.sku === 'P4');
    assertEqual(w.soldRevenue, 600, 'past revenue uses snapshot');
    assertEqual(w.soldCost, 400, 'past cost uses snapshot');
    assertEqual(w.profit, sale.profit);
  });

  // 5. Extra expenses CRUD + validation + netProfit
  await checkAsync('5. expenses add/update/delete + netProfit', async () => {
    const { adapter, cats } = await mk();
    const prod = await P.createProduct(adapter, { sku: 'E1', name: 'شورط', categoryId: cats[0], purchasePrice: 500, salePrice: 800, quantity: 5, lowStockThreshold: 5 });
    await SA.createStoreSale(adapter, { items: [{ productId: prod.id, quantity: 1 }] }); // profit 300
    const e1 = await EX.addExpense(adapter, { description: 'كهرباء', amount: 100 });
    await EX.addExpense(adapter, { description: 'كراء', amount: 50 });
    let sum = await EX.getFinancialSummary(adapter);
    assertEqual(sum.grossProfit, 300);
    assertEqual(sum.extraExpenses, 150);
    assertEqual(sum.netProfit, 150);
    await EX.updateExpense(adapter, e1.expenseId, { description: 'كهرباء', amount: 200 });
    sum = await EX.getFinancialSummary(adapter);
    assertEqual(sum.extraExpenses, 250);
    assertEqual(sum.netProfit, 50);
    await EX.deleteExpense(adapter, e1.expenseId);
    sum = await EX.getFinancialSummary(adapter);
    assertEqual(sum.extraExpenses, 50);
    await expectReject(() => EX.addExpense(adapter, { description: '', amount: 10 }), 'وصف المصروف مطلوب', 'empty description');
    await expectReject(() => EX.addExpense(adapter, { description: 'x', amount: -5 }), 'أكبر من صفر', 'negative amount');
    await expectReject(() => EX.addExpense(adapter, { description: 'x', amount: 1.5 }), 'عددا صحيحا', 'decimal amount');
    await expectReject(() => EX.deleteExpense(adapter, 999), 'غير موجود', 'delete missing');
  });

  // 6. Date range filtering
  await checkAsync('6. date range filters products/expenses', async () => {
    const { db, adapter, cats } = await mk();
    const prod = await P.createProduct(adapter, { sku: 'D6', name: 'رباط ركبة', categoryId: cats[2], purchasePrice: 100, salePrice: 200, quantity: 10, lowStockThreshold: 5 });
    const s1 = await SA.createStoreSale(adapter, { items: [{ productId: prod.id, quantity: 1 }] });
    setSaleDate(db, s1.saleId, '2026-01-05 10:00:00');
    const s2 = await SA.createStoreSale(adapter, { items: [{ productId: prod.id, quantity: 2 }] });
    setSaleDate(db, s2.saleId, '2026-02-10 10:00:00');
    await EX.addExpense(adapter, { description: 'نقل', amount: 30, date: '2026-01-20' });
    await EX.addExpense(adapter, { description: 'نقل2', amount: 70, date: '2026-02-20' });
    const jan = await EX.getProductFinancials(adapter, { dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    assertEqual(jan.find(r => r.sku === 'D6').soldUnits, 1, 'january only 1 unit');
    const febSum = await EX.getFinancialSummary(adapter, { dateFrom: '2026-02-01', dateTo: '2026-02-28' });
    assertEqual(febSum.extraExpenses, 70, 'february expense only');
    assertEqual(febSum.totalRevenue, 400, 'february revenue');
    const all = await EX.getFinancialSummary(adapter);
    assertEqual(all.extraExpenses, 100);
    assertEqual(all.totalRevenue, 600);
  });

  // 7. Summary equals sum of product rows
  await checkAsync('7. getFinancialSummary == sum of getProductFinancials', async () => {
    const { adapter, cats } = await mk();
    const a = await P.createProduct(adapter, { sku: 'S7A', name: 'قميص', categoryId: cats[0], purchasePrice: 1000, salePrice: 1500, quantity: 4, lowStockThreshold: 5 });
    const b = await P.createProduct(adapter, { sku: 'S7B', name: 'سروال', categoryId: cats[0], purchasePrice: 700, salePrice: 1100, quantity: 6, lowStockThreshold: 5 });
    await SA.createStoreSale(adapter, { items: [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 3 }], discount: 150 });
    await SA.createOutsideSale(adapter, { items: [{ productId: b.id, quantity: 1 }], ...CUSTOMER });
    await EX.addExpense(adapter, { description: 'إنترنت', amount: 80 });
    const rows = await EX.getProductFinancials(adapter);
    const sum = await EX.getFinancialSummary(adapter);
    const s = (pick) => rows.reduce((t, r) => t + pick(r), 0);
    assertEqual(sum.totalRevenue, s(r => r.soldRevenue));
    assertEqual(sum.totalCost, s(r => r.soldCost));
    assertEqual(sum.grossProfit, s(r => r.profit));
    assertEqual(sum.totalStockCost, s(r => r.stockCost));
    assertEqual(sum.pendingExpectedProfit, s(r => r.pendingExpectedProfit));
    assertEqual(sum.netProfit, sum.grossProfit - sum.extraExpenses);
  });

  // 8. Cancelled sales never count
  await checkAsync('8. cancelled store sale excluded', async () => {
    const { adapter, cats } = await mk();
    const prod = await P.createProduct(adapter, { sku: 'C8', name: 'كوردو', categoryId: cats[1], purchasePrice: 300, salePrice: 450, quantity: 10, lowStockThreshold: 5 });
    const sale = await SA.createStoreSale(adapter, { items: [{ productId: prod.id, quantity: 4 }] });
    await SA.cancelStoreSale(adapter, sale.saleId, 'خطأ');
    const rows = await EX.getProductFinancials(adapter);
    const r = rows.find(x => x.sku === 'C8');
    assertEqual(r.soldUnits, 0, 'cancelled not counted');
    assertEqual(r.profit, 0);
    assertEqual(r.quantity, 10, 'stock restored');
    const sum = await EX.getFinancialSummary(adapter);
    assertEqual(sum.totalRevenue, 0);
  });

  console.log(`\ntest-expenses: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
