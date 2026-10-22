// ===== Automated tests for outside sales / exports (src/services/sales.ts) =====
// In-memory better-sqlite3 + REAL migrations, same pattern as test-sales.mjs.

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

const CUSTOMER = { customerName: 'زبون تجريبي', customerPhone: '0555123456' };

async function main() {
  const P = await import(pathToFileURL(path.join(ROOT, 'src/services/products.ts')).href);
  const SA = await import(pathToFileURL(path.join(ROOT, 'src/services/sales.ts')).href);
  const ST = await import(pathToFileURL(path.join(ROOT, 'src/services/stock.ts')).href);
  const PH = await import(pathToFileURL(path.join(ROOT, 'src/lib/phone.ts')).href);

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

  // ---------- a. core scenario ----------
  {
    const { db, adapter, whistle } = await mk();
    await checkAsync('a. createOutsideSale 5 of 10 -> pending, stock 5 immediately, one sale_outside -5 movement', async () => {
      await P.updateProduct(adapter, whistle.id, { sku: 'W-001', name: 'صفارة', categoryId: 2, purchasePrice: 200, salePrice: 300, lowStockThreshold: 5 });
      db.prepare('UPDATE products SET quantity = 10 WHERE id = ?').run(whistle.id);
      const r = await SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 5 }], ...CUSTOMER });
      const s = db.prepare('SELECT * FROM sales WHERE id=?').get(r.saleId);
      assertEqual(s.type, 'outside', 'type');
      assertEqual(s.status, 'pending', 'status');
      assertEqual(qtyOf(db, whistle.id), 5, 'quantity reserved');
      const mv = db.prepare("SELECT * FROM stock_movements WHERE product_id=? AND type='sale_outside'").all(whistle.id);
      assertEqual(mv.length, 1, 'movement count');
      assertEqual(mv[0].quantity_change, -5, 'change');
      assertEqual(mv[0].quantity_after, 5, 'after');
      assertEqual(mv[0].reference_id, r.saleId, 'referenceId');
    });
  }

  // ---------- b. pending NOT in revenue/profit, IS in pending totals ----------
  {
    const { adapter, whistle } = await mk();
    await checkAsync('b. pending order excluded from revenue/profit; exact pendingCount/pendingExpectedRevenue/pendingExpectedProfit', async () => {
      await SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 5 }], ...CUSTOMER });
      const sum = await SA.getSalesSummary(adapter, {});
      assertEqual(sum.salesCount, 0, 'confirmed count');
      assertEqual(sum.revenue, 0, 'revenue');
      assertEqual(sum.profit, 0, 'profit');
      assertEqual(sum.pendingCount, 1, 'pendingCount');
      assertEqual(sum.pendingExpectedRevenue, 1500, 'pendingExpectedRevenue');   // 5*300
      assertEqual(sum.pendingExpectedProfit, 500, 'pendingExpectedProfit');       // 1500 - 5*200
    });
  }

  // ---------- c. confirm ----------
  {
    const { db, adapter, whistle } = await mk();
    await checkAsync('c. confirmOutsideSale -> confirmed, confirmed_at set, stock unchanged, revenue included, pending drops', async () => {
      const r = await SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 5 }], ...CUSTOMER });
      await SA.confirmOutsideSale(adapter, r.saleId);
      const s = db.prepare('SELECT * FROM sales WHERE id=?').get(r.saleId);
      assertEqual(s.status, 'confirmed', 'status');
      assert(s.confirmed_at && String(s.confirmed_at).trim().length > 0, 'confirmed_at set');
      assertEqual(qtyOf(db, whistle.id), 15, 'stock unchanged by confirm');
      const sum = await SA.getSalesSummary(adapter, {});
      assertEqual(sum.salesCount, 1, 'confirmed count');
      assertEqual(sum.revenue, 1500, 'revenue');
      assertEqual(sum.profit, 500, 'profit');
      assertEqual(sum.pendingCount, 0, 'pendingCount dropped');
      assertEqual(sum.pendingExpectedRevenue, 0, 'pending revenue dropped');
    });
  }

  // ---------- d. invalid confirms ----------
  {
    const { adapter, whistle, jersey } = await mk();
    await checkAsync('d. confirming twice / cancelled / store sale -> all rejected', async () => {
      const r = await SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 1 }], ...CUSTOMER });
      await SA.confirmOutsideSale(adapter, r.saleId);
      await expectReject(() => SA.confirmOutsideSale(adapter, r.saleId), 'مؤكد مسبقا', 'double confirm');
      const r2 = await SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 1 }], ...CUSTOMER });
      await SA.cancelOutsideSale(adapter, r2.saleId);
      await expectReject(() => SA.confirmOutsideSale(adapter, r2.saleId), 'ملغى', 'confirm cancelled');
      const st = await SA.createStoreSale(adapter, { items: [{ productId: jersey.id, quantity: 1 }] });
      await expectReject(() => SA.confirmOutsideSale(adapter, st.saleId), 'طلبات التصدير فقط', 'confirm store sale');
    });
  }

  // ---------- e. cancel ----------
  {
    const { db, adapter, whistle } = await mk();
    await checkAsync('e. cancelOutsideSale on pending -> stock back (+5 cancel_return), excluded from totals; double-cancel and cancel-confirmed rejected', async () => {
      const r = await SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 5 }], ...CUSTOMER });
      assertEqual(qtyOf(db, whistle.id), 15, 'reserved');
      await SA.cancelOutsideSale(adapter, r.saleId);
      assertEqual(qtyOf(db, whistle.id), 20, 'restored');
      const mv = db.prepare("SELECT * FROM stock_movements WHERE type='cancel_return' AND reference_id=?").all(r.saleId);
      assertEqual(mv.length, 1, 'one cancel_return movement');
      assertEqual(mv[0].quantity_change, 5, 'positive change');
      const s = db.prepare('SELECT * FROM sales WHERE id=?').get(r.saleId);
      assertEqual(s.status, 'cancelled', 'status cancelled');
      const sum = await SA.getSalesSummary(adapter, {});
      assertEqual(sum.revenue, 0, 'no revenue');
      assertEqual(sum.pendingCount, 0, 'not pending anymore');
      await expectReject(() => SA.cancelOutsideSale(adapter, r.saleId), 'ملغى مسبقا', 'double cancel');
      const r2 = await SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 2 }], ...CUSTOMER });
      await SA.confirmOutsideSale(adapter, r2.saleId);
      await expectReject(() => SA.cancelOutsideSale(adapter, r2.saleId), 'لا يمكن إلغاء طلب مؤكد', 'cancel confirmed');
    });
  }

  // ---------- f. insufficient stock second line -> all-or-nothing ----------
  {
    const { db, adapter, whistle, jersey } = await mk();
    await checkAsync('f. insufficient stock on 2nd line -> whole order rejected, nothing saved, Arabic error with available qty', async () => {
      await expectReject(
        () => SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 2 }, { productId: jersey.id, quantity: 999 }], ...CUSTOMER }),
        'الكمية المتوفرة من (تي شيرت) هي 10 فقط', 'overdraw');
      assertEqual(qtyOf(db, whistle.id), 20, 'whistle unchanged');
      assertEqual(db.prepare('SELECT COUNT(*) c FROM sales').get().c, 0, 'no sale row');
      assertEqual(db.prepare('SELECT COUNT(*) c FROM sale_items').get().c, 0, 'no items');
      assertEqual(db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE type='sale_outside'").get().c, 0, 'no movements');
    });
  }

  // ---------- g. customer validation ----------
  {
    const { adapter, whistle } = await mk();
    await checkAsync('g. missing name / missing phone / invalid phone -> rejected in Arabic', async () => {
      await expectReject(() => SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 1 }], customerPhone: '0555123456' }), 'اسم الزبون مطلوب', 'missing name');
      await expectReject(() => SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 1 }], customerName: 'زبون' }), 'رقم الهاتف مطلوب', 'missing phone');
      await expectReject(() => SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 1 }], ...CUSTOMER, customerPhone: 'abc123!' }), 'غير صالح', 'invalid chars');
      await expectReject(() => SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 1 }], ...CUSTOMER, customerPhone: '12345' }), '8 أرقام', 'too short');
    });
  }

  // ---------- h. price snapshots ----------
  {
    const { adapter, whistle } = await mk();
    await checkAsync('h. changing product price after the order does not change its totals/profit', async () => {
      const r = await SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 5 }], ...CUSTOMER });
      await SA.confirmOutsideSale(adapter, r.saleId);
      await P.updateProduct(adapter, whistle.id, { sku: 'W-001', name: 'صفارة', categoryId: 2, purchasePrice: 250, salePrice: 400, lowStockThreshold: 5 });
      const full = await SA.getSaleById(adapter, r.saleId);
      assertEqual(full.total, 1500, 'total unchanged');
      assertEqual(full.profit, 500, 'profit unchanged');
      assertEqual(full.items[0].sale_price, 300, 'snapshot sale price');
      assertEqual(full.items[0].purchase_price, 200, 'snapshot purchase price');
      const sum = await SA.getSalesSummary(adapter, {});
      assertEqual(sum.revenue, 1500, 'summary revenue unchanged');
    });
  }

  // ---------- i. mixed day with type filters ----------
  {
    const { adapter, whistle, jersey } = await mk();
    await checkAsync('i. mixed store/outside (pending, confirmed, cancelled): summary with type store / outside / all exact', async () => {
      // store: sell 2 whistles -> revenue 600 cost 400 profit 200
      await SA.createStoreSale(adapter, { items: [{ productId: whistle.id, quantity: 2 }] });
      // outside confirmed: 3 jerseys -> revenue 6600 cost 4500 profit 2100
      const oc = await SA.createOutsideSale(adapter, { items: [{ productId: jersey.id, quantity: 3 }], ...CUSTOMER });
      await SA.confirmOutsideSale(adapter, oc.saleId);
      // outside pending: 5 whistles -> expected revenue 1500 profit 500
      await SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 5 }], ...CUSTOMER });
      // outside cancelled: 1 jersey
      const ox = await SA.createOutsideSale(adapter, { items: [{ productId: jersey.id, quantity: 1 }], ...CUSTOMER });
      await SA.cancelOutsideSale(adapter, ox.saleId);

      const all = await SA.getSalesSummary(adapter, { type: 'all' });
      assertEqual(all.salesCount, 2, 'all confirmed count');
      assertEqual(all.revenue, 600 + 6600, 'all revenue');
      assertEqual(all.cost, 400 + 4500, 'all cost');
      assertEqual(all.profit, 200 + 2100, 'all profit');
      assertEqual(all.unitsSold, 5, 'all units');
      assertEqual(all.pendingCount, 1, 'all pendingCount');
      assertEqual(all.pendingExpectedRevenue, 1500, 'all pendingRevenue');

      const store = await SA.getSalesSummary(adapter, { type: 'store' });
      assertEqual(store.salesCount, 1, 'store count');
      assertEqual(store.revenue, 600, 'store revenue');
      assertEqual(store.profit, 200, 'store profit');
      assertEqual(store.pendingCount, 0, 'store pendingCount');

      const out = await SA.getSalesSummary(adapter, { type: 'outside' });
      assertEqual(out.salesCount, 1, 'outside confirmed count');
      assertEqual(out.revenue, 6600, 'outside revenue');
      assertEqual(out.profit, 2100, 'outside profit');
      assertEqual(out.pendingCount, 1, 'outside pendingCount');
      assertEqual(out.pendingExpectedRevenue, 1500, 'outside pendingRevenue');
      assertEqual(out.pendingExpectedProfit, 500, 'outside pendingProfit');
    });
  }

  // ---------- j. concurrency ----------
  {
    const { db, adapter, whistle } = await mk();
    await checkAsync('j. 10 parallel createOutsideSale of 3 units on qty 20 -> exactly 6 succeed, 4 fail, final qty 2', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => SA.createOutsideSale(adapter, { items: [{ productId: whistle.id, quantity: 3 }], ...CUSTOMER })),
      );
      const okCount = results.filter((r) => r.status === 'fulfilled').length;
      const failCount = results.filter((r) => r.status === 'rejected').length;
      assertEqual(okCount, 6, 'succeeded');
      assertEqual(failCount, 4, 'failed');
      assertEqual(qtyOf(db, whistle.id), 2, 'final quantity');
      const bad = results.filter((r) => r.status === 'rejected');
      for (const b of bad) assert(stripArabicDiacritics(String(b.reason.message)).includes('الكمية المتوفرة'), 'failure reason is the Arabic stock error');
    });
  }

  // ---------- k. random sequence integrity ----------
  {
    const { db, adapter, whistle, jersey } = await mk();
    await checkAsync('k. 200 random ops (create/confirm/cancel, store+outside, fixed seed) -> verifyStockIntegrity empty & stock matches', async () => {
      let seed = 42;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      const ids = [whistle.id, jersey.id];
      for (let i = 0; i < 200; i++) {
        const op = Math.floor(rnd() * 4);
        try {
          if (op === 0) {
            await SA.createStoreSale(adapter, { items: [{ productId: ids[Math.floor(rnd() * 2)], quantity: 1 + Math.floor(rnd() * 3) }] });
          } else if (op === 1) {
            await SA.createOutsideSale(adapter, { items: [{ productId: ids[Math.floor(rnd() * 2)], quantity: 1 + Math.floor(rnd() * 3) }], ...CUSTOMER });
          } else if (op === 2) {
            const pend = await SA.getPendingOutsideSales(adapter);
            if (pend.length) await SA.confirmOutsideSale(adapter, pend[Math.floor(rnd() * pend.length)].id);
          } else {
            const pend = await SA.getPendingOutsideSales(adapter);
            if (pend.length) await SA.cancelOutsideSale(adapter, pend[Math.floor(rnd() * pend.length)].id);
          }
        } catch { /* stock errors are expected sometimes */ }
      }
      const broken = await ST.verifyStockIntegrity(adapter);
      assertEqual(broken.length, 0, `integrity violations: ${JSON.stringify(broken)}`);
      // stock == initial - units in pending+confirmed sales
      for (const id of ids) {
        const init = db.prepare("SELECT COALESCE(SUM(quantity_change),0) s FROM stock_movements WHERE product_id=? AND type='initial'").get(id).s;
        const activeUnits = db.prepare(
          `SELECT COALESCE(SUM(si.quantity),0) q FROM sale_items si JOIN sales s ON s.id=si.sale_id
           WHERE si.product_id=? AND s.status IN ('pending','confirmed')`,
        ).get(id).q;
        assertEqual(qtyOf(db, id), init - activeUnits, `stock math for product ${id}`);
      }
    });
  }

  // ---------- l. phone helper ----------
  {
    await checkAsync('l. toWhatsAppNumber conversions and invalid -> null', async () => {
      assertEqual(PH.toWhatsAppNumber('0555123456'), '213555123456', 'local 0 format');
      assertEqual(PH.toWhatsAppNumber('+213 555 12 34 56'), '213555123456', 'international with spaces');
      assertEqual(PH.toWhatsAppNumber('00213555123456'), '213555123456', '00 prefix');
      assertEqual(PH.toWhatsAppNumber('abc'), null, 'letters invalid');
      assertEqual(PH.toWhatsAppNumber('123'), null, 'too short invalid');
      assertEqual(PH.toWhatsAppNumber(''), null, 'empty invalid');
      assertEqual(PH.whatsappUrl('0555123456'), 'https://wa.me/213555123456', 'url helper');
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
