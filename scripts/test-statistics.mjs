// ===== Automated tests for statistics (src/services/statistics.ts) =====
// In-memory better-sqlite3 + REAL migrations, same pattern as test-expenses.mjs.

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
function setSaleDate(db, saleId, dateStr) { db.prepare(`UPDATE sales SET created_at = ? WHERE id = ?`).run(dateStr, saleId); }
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 10:00:00`;
}
function isoDay(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const CUSTOMER = { customerName: 'زبون', customerPhone: '0555123456' };

async function main() {
  const P = await import(pathToFileURL(path.join(ROOT, 'src/services/products.ts')).href);
  const SA = await import(pathToFileURL(path.join(ROOT, 'src/services/sales.ts')).href);
  const EX = await import(pathToFileURL(path.join(ROOT, 'src/services/expenses.ts')).href);
  const ST = await import(pathToFileURL(path.join(ROOT, 'src/services/stock.ts')).href);
  const STATS = await import(pathToFileURL(path.join(ROOT, 'src/services/statistics.ts')).href);

  const mk = async () => {
    const db = freshDb();
    const adapter = makeAdapter(db);
    const cat = await adapter.query('SELECT id FROM categories ORDER BY id');
    return { db, adapter, cats: cat.map((c) => c.id) };
  };

  // Build mixed data used by several tests:
  // store: 2 whistles (profit 2*100=200 rev 600 cost 400) + cancelled jersey
  // outside confirmed: 1 ball (rev 1000 cost 800 profit 200)
  // outside pending: 3 whistles (expected rev 900 cost 600 profit 300)
  // outside cancelled: 2 balls
  // expense 150
  async function buildMixed() {
    const ctx = await mk();
    const { adapter, cats, db } = ctx;
    const whistle = await P.createProduct(adapter, { sku: 'SW', name: 'صفارة', categoryId: cats[0], purchasePrice: 200, salePrice: 300, quantity: 50, lowStockThreshold: 5 });
    const ball = await P.createProduct(adapter, { sku: 'SB', name: 'بالون', categoryId: cats[1], purchasePrice: 800, salePrice: 1000, quantity: 30, lowStockThreshold: 5 });
    const jersey = await P.createProduct(adapter, { sku: 'SJ', name: 'دوصار', categoryId: cats[0], purchasePrice: 1500, salePrice: 2200, quantity: 10, lowStockThreshold: 5 });
    ctx.ids = { whistle: whistle.id, ball: ball.id, jersey: jersey.id };
    await SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 2 }] });
    const s2 = await SA.createStoreSale(adapter, { items: [{ productId: jersey.id, quantity: 1 }] });
    await SA.cancelStoreSale(adapter, s2.saleId, 'خطأ');
    const o1 = await SA.createOutsideSale(adapter, { items: [{ productId: ball.id, quantity: 1 }], ...CUSTOMER });
    await SA.confirmOutsideSale(adapter, o1.saleId);
    const o2 = await SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 3 }], ...CUSTOMER });
    const o3 = await SA.createOutsideSale(adapter, { items: [{ productId: ball.id, quantity: 2 }], ...CUSTOMER });
    await SA.cancelOutsideSale(adapter, o3.saleId);
    await EX.addExpense(adapter, { description: 'كراء', amount: 150 });
    ctx.pendingOrder = o2;
    ctx.db = db;
    return ctx;
  }

  // a. Channel summary exact numbers
  await checkAsync('a. mixed data channel totals exact', async () => {
    const ctx = await buildMixed();
    const sum = await STATS.getChannelSummary(ctx.adapter);
    assertEqual(sum.store.salesCount, 1, 'store count excludes cancelled');
    assertEqual(sum.store.revenue, 600);
    assertEqual(sum.store.cost, 400);
    assertEqual(sum.store.profit, 200);
    assertEqual(sum.store.unitsSold, 2);
    assertEqual(sum.outside.salesCount, 1, 'outside count excludes cancelled/pending');
    assertEqual(sum.outside.revenue, 1000);
    assertEqual(sum.outside.profit, 200);
    assertEqual(sum.combined.revenue, 1600);
    assertEqual(sum.combined.profit, 400);
    assertEqual(sum.extraExpenses, 150);
    assertEqual(sum.netProfit, 250);
  });

  // b. Pending only in pending fields
  await checkAsync('b. pending appears only in pending fields', async () => {
    const ctx = await buildMixed();
    const sum = await STATS.getChannelSummary(ctx.adapter);
    assertEqual(sum.pendingCount, 1);
    assertEqual(sum.pendingExpectedRevenue, 900);
    assertEqual(sum.store.revenue + sum.outside.revenue, sum.combined.revenue, 'pending not in revenues');
    // confirm the pending order -> moves to outside
    await SA.confirmOutsideSale(ctx.adapter, ctx.pendingOrder.saleId);
    const sum2 = await STATS.getChannelSummary(ctx.adapter);
    assertEqual(sum2.pendingCount, 0);
    assertEqual(sum2.outside.revenue, 1900);
    assertEqual(sum2.outside.profit, 500);
  });

  // c. Time series zero-filled + totals match channel summary
  await checkAsync('c. time series day/week/month zero-filled and totals', async () => {
    const ctx = await buildMixed();
    const from = isoDay(-6), to = isoDay(0);
    const day = await STATS.getSalesTimeSeries(ctx.adapter, { dateFrom: from, dateTo: to, granularity: 'day' });
    assertEqual(day.length, 7, 'zero-filled 7 days');
    const today = day[6];
    assertEqual(today.storeRevenue, 600);
    assertEqual(today.outsideRevenue, 1000);
    assertEqual(today.profit, 400);
    assertEqual(today.expenses, 150);
    const daySum = day.reduce((s, p) => s + p.storeRevenue + p.outsideRevenue, 0);
    const sum = await STATS.getChannelSummary(ctx.adapter, { dateFrom: from, dateTo: to });
    assertEqual(daySum, sum.combined.revenue, 'series totals == channel summary');
    const week = await STATS.getSalesTimeSeries(ctx.adapter, { dateFrom: isoDay(-13), dateTo: to, granularity: 'week' });
    assert(week.length >= 2 && week.length <= 3, 'weekly buckets');
    const wkSum = week.reduce((s, p) => s + p.storeRevenue + p.outsideRevenue, 0);
    assertEqual(wkSum, sum.combined.revenue);
    const month = await STATS.getSalesTimeSeries(ctx.adapter, { dateFrom: isoDay(-6), dateTo: to, granularity: 'month' });
    assert(month.length >= 1 && month.length <= 2, 'monthly buckets');
    assertEqual(month.reduce((s, p) => s + p.profit, 0), sum.combined.profit);
  });

  // d. Top products by units and profit, ordering + limit
  await checkAsync('d. getTopProducts ordering and limit', async () => {
    const ctx = await buildMixed();
    const byUnits = await STATS.getTopProducts(ctx.adapter, { by: 'units', limit: 5 });
    assertEqual(byUnits.length, 2, 'only sold products (cancelled excluded)');
    assertEqual(byUnits[0].sku, 'SW', 'whistle first (2 units vs 1)');
    assertEqual(byUnits[0].unitsSold, 2);
    const byProfit = await STATS.getTopProducts(ctx.adapter, { by: 'profit', limit: 5 });
    assertEqual(byProfit[0].sku, 'SW', 'whistle first: profit 200 > ball profit 100');
    assertEqual(byProfit[1].sku, 'SB');
    const limited = await STATS.getTopProducts(ctx.adapter, { by: 'units', limit: 1 });
    assertEqual(limited.length, 1);
  });

  // e. Category breakdown sums == channel summary totals
  await checkAsync('e. category breakdown equals totals', async () => {
    const ctx = await buildMixed();
    const bd = await STATS.getCategoryBreakdown(ctx.adapter);
    const sum = await STATS.getChannelSummary(ctx.adapter);
    assertEqual(bd.reduce((s, r) => s + r.revenue, 0), sum.combined.revenue);
    assertEqual(bd.reduce((s, r) => s + r.cost, 0), sum.combined.cost);
    assertEqual(bd.reduce((s, r) => s + r.profit, 0), sum.combined.profit);
    const clothes = bd.find((r) => r.category_name === 'ملابس رياضية');
    assertEqual(clothes.revenue, 600, 'sports clothing = whistle sales only');
  });

  // f. Slow moving detection
  await checkAsync('f. slow-moving 40-days-ago yes, yesterday no, zero stock no', async () => {
    const ctx = await mk();
    const { adapter, db, cats } = ctx;
    const old = await P.createProduct(adapter, { sku: 'OLD', name: 'منتج قديم', categoryId: cats[0], purchasePrice: 100, salePrice: 200, quantity: 5, lowStockThreshold: 5 });
    const recent = await P.createProduct(adapter, { sku: 'NEW', name: 'منتج حديث', categoryId: cats[0], purchasePrice: 100, salePrice: 200, quantity: 5, lowStockThreshold: 5 });
    await P.createProduct(adapter, { sku: 'NEV', name: 'لم يبع', categoryId: cats[0], purchasePrice: 100, salePrice: 200, quantity: 5, lowStockThreshold: 5 });
    const empty = await P.createProduct(adapter, { sku: 'EMP', name: 'نفد', categoryId: cats[0], purchasePrice: 100, salePrice: 200, quantity: 2, lowStockThreshold: 5 });
    const sOld = await SA.createStoreSale(adapter, { items: [{ productId: old.id, quantity: 1 }] });
    setSaleDate(db, sOld.saleId, daysAgo(40));
    await SA.createStoreSale(adapter, { items: [{ productId: recent.id, quantity: 1 }] });
    await SA.createStoreSale(adapter, { items: [{ productId: empty.id, quantity: 2 }] }); // qty -> 0
    const slow = await STATS.getSlowMovingProducts(adapter, { days: 30 });
    const skus = slow.map((r) => r.sku);
    assert(skus.includes('OLD'), 'sold 40 days ago appears');
    assert(skus.includes('NEV'), 'never sold appears');
    assert(!skus.includes('NEW'), 'sold yesterday does not appear');
    assert(!skus.includes('EMP'), 'zero stock excluded');
  });

  // g. Stock alerts
  await checkAsync('g. stock alerts low + out', async () => {
    const ctx = await mk();
    const { adapter } = ctx;
    await P.createProduct(adapter, { sku: 'OK', name: 'متوفر', categoryId: 1, purchasePrice: 10, salePrice: 20, quantity: 50, lowStockThreshold: 5 });
    await P.createProduct(adapter, { sku: 'LOW', name: 'قارب', categoryId: 1, purchasePrice: 10, salePrice: 20, quantity: 3, lowStockThreshold: 5 });
    await P.createProduct(adapter, { sku: 'OUT', name: 'نافد', categoryId: 1, purchasePrice: 10, salePrice: 20, quantity: 0, lowStockThreshold: 5 });
    const alerts = await STATS.getStockAlerts(adapter);
    const skus = alerts.map((r) => r.sku).sort();
    assertEqual(JSON.stringify(skus), JSON.stringify(['LOW', 'OUT']));
  });

  // h. Cancelled never count anywhere
  await checkAsync('h. cancelled excluded from every statistic', async () => {
    const ctx = await buildMixed();
    const sum = await STATS.getChannelSummary(ctx.adapter);
    // combined revenue must be exactly store(600)+outside(1000), ignoring cancelled jersey(2200) & cancelled balls(2000) and pending(900)
    assertEqual(sum.combined.revenue, 1600);
    assertEqual(sum.combined.unitsSold, 3);
    const top = await STATS.getTopProducts(ctx.adapter, { by: 'units', limit: 10 });
    assert(!top.some((t) => t.sku === 'SJ'), 'cancelled-only product absent from top');
    const ts = await STATS.getSalesTimeSeries(ctx.adapter, { dateFrom: isoDay(-6), dateTo: isoDay(0), granularity: 'day' });
    assertEqual(ts.reduce((s, p) => s + p.storeRevenue + p.outsideRevenue, 0), 1600);
  });

  // i. Random sequence integrity (fixed seed)
  await checkAsync('i. random 200 ops: integrity holds', async () => {
    const ctx = await mk();
    const { adapter } = ctx;
    const rnd = mulberry32(42);
    const prods = [];
    for (let i = 0; i < 5; i++) {
      prods.push(await P.createProduct(adapter, { sku: `R${i}`, name: `منتج ${i}`, categoryId: (i % 3) + 1, purchasePrice: 100 + i * 50, salePrice: 200 + i * 50, quantity: 200, lowStockThreshold: 5 }));
    }
    const saleIds = [];
    for (let op = 0; op < 200; op++) {
      const p = prods[Math.floor(rnd() * prods.length)];
      const q = 1 + Math.floor(rnd() * 5);
      try {
        if (rnd() < 0.5) {
          const s = await SA.createStoreSale(adapter, { items: [{ productId: p.id, quantity: q }] });
          saleIds.push({ id: s.saleId, type: 'store' });
        } else {
          const s = await SA.createOutsideSale(adapter, { items: [{ productId: p.id, quantity: q }], ...CUSTOMER });
          saleIds.push({ id: s.saleId, type: 'outside' });
        }
      } catch { /* stock errors are fine */ }
      if (saleIds.length > 0 && rnd() < 0.2) {
        const pick = saleIds[Math.floor(rnd() * saleIds.length)];
        try {
          if (pick.type === 'store') await SA.cancelStoreSale(adapter, pick.id);
          else {
            const st = await SA.getSaleById(adapter, pick.id);
            if (st?.status === 'pending') { if (rnd() < 0.5) await SA.confirmOutsideSale(adapter, pick.id); else await SA.cancelOutsideSale(adapter, pick.id); }
          }
        } catch { /* ignore */ }
      }
    }
    const bad = await ST.verifyStockIntegrity(adapter);
    assertEqual(bad.length, 0, 'integrity after random ops');
  });

  console.log(`\ntest-statistics: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
