// ===== Tests for settings service + invoice HTML builder =====
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
  assert(stripArabicDiacritics(String(threw.message ?? threw)).includes(stripArabicDiacritics(msgPart)), `${label}: error "${threw.message}" should contain "${msgPart}"`);
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

const { getSettings, updateSettings, setSetting } = await import(pathToFileURL(path.join(ROOT, 'src/services/settings.ts')).href);
const { createStoreSale, getSaleById } = await import(pathToFileURL(path.join(ROOT, 'src/services/sales.ts')).href);
const { buildInvoiceHtml } = await import(pathToFileURL(path.join(ROOT, 'src/lib/invoice.ts')).href);
const { createProduct } = await import(pathToFileURL(path.join(ROOT, 'src/services/products.ts')).href);

// 1. Defaults when keys missing
await checkAsync('defaults when keys are missing', async () => {
  const db = makeAdapter(freshDb());
  const s = await getSettings(db);
  assertEqual(s.shopName, 'المحل الرياضي');
  assertEqual(s.currency, 'دج');
  assertEqual(s.invoiceFooter, 'شكرا لتعاملكم معنا');
  assertEqual(s.lastAutoBackupAt, '');
});

// 2. Update + persistence
await checkAsync('update persists values', async () => {
  const db = makeAdapter(freshDb());
  const s = await updateSettings(db, { shopName: 'محل النخبة', currency: 'دج', shopPhone: '0555000011', shopAddress: 'وسط المدينة', invoiceFooter: 'بالتوفيق' });
  assertEqual(s.shopName, 'محل النخبة');
  const again = await getSettings(db);
  assertEqual(again.shopName, 'محل النخبة');
  assertEqual(again.shopPhone, '0555000011');
});

// 3. Validation in Arabic
await checkAsync('empty shop name rejected in Arabic', async () => {
  const db = makeAdapter(freshDb());
  await expectReject(() => updateSettings(db, { shopName: '   ', currency: 'دج' }), 'اسم المحل مطلوب', 'name required');
});

// 4. setSetting raw key
await checkAsync('setSetting writes a single key', async () => {
  const db = makeAdapter(freshDb());
  await setSetting(db, 'last_auto_backup_at', '2026-10-25 10:00:00');
  const s = await getSettings(db);
  assertEqual(s.lastAutoBackupAt, '2026-10-25 10:00:00');
});

// 5. Invoice HTML: totals with odd discount, item rows, escaping
await checkAsync('invoice html has correct totals with odd discount 101', async () => {
  const raw = freshDb();
  const db = makeAdapter(raw);
  const w = await createProduct(db, { sku: 'W1', name: 'صفارة', categoryId: 1, purchasePrice: 200, salePrice: 300, quantity: 20, lowStockThreshold: 5 });
  const j = await createProduct(db, { sku: 'J1', name: '<b>جيرسيه</b>', categoryId: 1, purchasePrice: 1500, salePrice: 2200, quantity: 10, lowStockThreshold: 5 });
  const res = await createStoreSale(db, {
    items: [{ productId: w.id, quantity: 2 }, { productId: j.id, quantity: 1, unitPrice: 2000 }],
    discount: 101,
    customerName: 'زبون & <script>',
    customerPhone: '0555123456',
  });
  assertEqual(res.subtotal, 2 * 300 + 2000); // 2600
  assertEqual(res.total, 2600 - 101);        // 2499
  const sale = await getSaleById(db, res.saleId);
  const shop = await getSettings(db);
  const html = buildInvoiceHtml(sale, shop);
  assert(html.includes('dir="rtl"'), 'html must be RTL');
  assert(html.includes('lang="ar"'), 'html must be Arabic');
  assert(html.includes('2,600'), 'subtotal shown formatted');
  assert(html.includes('101'), 'discount shown');
  assert(html.includes('2,499'), 'total shown');
  assert(html.includes('فاتورة بيع'), 'store invoice title');
  assert(html.includes(shop.shopName), 'shop header');
  assert(html.includes('&lt;b&gt;جيرسيه&lt;/b&gt;'), 'product name escaped');
  assert(html.includes('زبون &amp; &lt;script&gt;'), 'customer name escaped');
  assert(!html.includes('<script>'), 'no raw script tag injected');
  const rowCount = (html.match(/<td>صفارة<\/td>|<td>&lt;b&gt;جيرسيه&lt;\/b&gt;<\/td>/g) || []).length;
  assertEqual(rowCount, 2, 'two item rows');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
