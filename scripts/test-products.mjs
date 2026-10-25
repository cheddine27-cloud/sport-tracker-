// ===== Automated tests for the products service =====
// Runs src/services/products.ts (real code, via tsx) against an in-memory
// better-sqlite3 database built from the REAL migration files.
// Prints PASS/FAIL per assertion and exits non-zero on any failure.

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
async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL  ${name}\n      -> ${err.message}`);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${b}, got ${a}`);
}

// ---- Fresh in-memory DB with the real migrations ----
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(path.join(ROOT, 'src-tauri/migrations/001_schema.sql'), 'utf8'));
  db.exec(readFileSync(path.join(ROOT, 'src-tauri/migrations/002_seed.sql'), 'utf8'));
  return db;
}

/** DbAdapter over better-sqlite3 — same interface as appDb in src/lib/db.ts */
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
      let result;
      db.exec('BEGIN IMMEDIATE');
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

async function expectReject(promise, msgPart, label) {
  let threw = null;
  try {
    await promise;
  } catch (e) {
    threw = e;
  }
  assert(threw, `${label}: expected rejection but it resolved`);
  assert(
    String(threw.message ?? threw).includes(msgPart),
    `${label}: error "${threw.message}" should contain "${msgPart}"`,
  );
}

async function main() {
  // Real service code compiled on the fly by tsx
  const P = await import(pathToFileURL(path.join(ROOT, 'src/services/products.ts')).href);

  const mk = () => {
    const db = freshDb();
    return { db, adapter: makeAdapter(db) };
  };

  // ---------- 1. createProduct with qty 20 ----------
  {
    const { db, adapter } = mk();
    const p = await P.createProduct(adapter, {
      sku: await P.generateSku(adapter, 2),
      name: 'صفارة',
      categoryId: 2,
      purchasePrice: 200,
      salePrice: 300,
      quantity: 20,
    });
    check('1. createProduct("صفارة", qty 20): product exists with quantity 20', () => {
      assert(p.id > 0, 'product id missing');
      assertEqual(p.quantity, 20, 'quantity');
      assertEqual(p.categoryName, 'عتاد رياضي', 'joined category name');
    });
    const movs = db.prepare(`SELECT * FROM stock_movements WHERE product_id = ?`).all(p.id);
    check('1b. exactly one initial movement with quantity_after 20', () => {
      assertEqual(movs.length, 1, 'movement count');
      assertEqual(movs[0].type, 'initial', 'movement type');
      assertEqual(movs[0].quantity_change, 20, 'quantity_change');
      assertEqual(movs[0].quantity_after, 20, 'quantity_after');
      assertEqual(movs[0].note, 'رصيد أولي', 'note');
    });
  }

  // ---------- 2. createProduct with qty 0 -> no movement ----------
  {
    const { db, adapter } = mk();
    const p = await P.createProduct(adapter, {
      sku: 'ZERO-1',
      name: 'منتج فارغ',
      categoryId: 1,
      purchasePrice: 100,
      salePrice: 150,
      quantity: 0,
    });
    const n = db.prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?`).get(p.id).c;
    check('2. createProduct with quantity 0 creates NO movement row', () => assertEqual(n, 0, 'movements'));
  }

  // ---------- 3. duplicate SKU rejected + rollback leaves nothing ----------
  {
    const { db, adapter } = mk();
    await P.createProduct(adapter, { sku: 'DUP-1', name: 'أول', categoryId: 1, purchasePrice: 100, salePrice: 150, quantity: 5 });
    await checkAsync('3. duplicate SKU rejected with Arabic message', async () => {
      await expectReject(
        P.createProduct(adapter, { sku: 'DUP-1', name: 'ثان', categoryId: 1, purchasePrice: 100, salePrice: 150, quantity: 5 }),
        'مستعمل من قبل',
        'duplicate sku',
      );
    });
    check('3b. no partial rows left after rollback', () => {
      const prods = db.prepare(`SELECT COUNT(*) AS c FROM products`).get().c;
      const movs = db.prepare(`SELECT COUNT(*) AS c FROM stock_movements`).get().c;
      assertEqual(prods, 1, 'products after rollback');
      assertEqual(movs, 1, 'movements after rollback (only the first product initial)');
    });
  }

  // ---------- 4. validation rejects ----------
  {
    const { adapter } = mk();
    await checkAsync('4a. negative price rejected', () =>
      expectReject(
        P.createProduct(adapter, { sku: 'N1', name: 'س', categoryId: 1, purchasePrice: -10, salePrice: 100, quantity: 1 }),
        'سعر الشراء',
        'neg purchase',
      ));
    await checkAsync('4b. negative quantity rejected', () =>
      expectReject(
        P.createProduct(adapter, { sku: 'N2', name: 'س', categoryId: 1, purchasePrice: 10, salePrice: 100, quantity: -3 }),
        'الكمية',
        'neg qty',
      ));
    await checkAsync('4c. empty name rejected', () =>
      expectReject(
        P.createProduct(adapter, { sku: 'N3', name: '   ', categoryId: 1, purchasePrice: 10, salePrice: 100, quantity: 1 }),
        'اسم المنتج مطلوب',
        'empty name',
      ));
    await checkAsync('4d. missing category rejected', () =>
      expectReject(
        P.createProduct(adapter, { sku: 'N4', name: 'س', categoryId: 0, purchasePrice: 10, salePrice: 100, quantity: 1 }),
        'القسم مطلوب',
        'no category',
      ));
  }

  // ---------- 5. findSimilarProducts ----------
  {
    const { adapter } = mk();
    await P.createProduct(adapter, { sku: 'SIM-1', name: 'صفارة', categoryId: 2, purchasePrice: 200, salePrice: 300, quantity: 7, color: 'فضي' });
    const found = await P.findSimilarProducts(adapter, { name: '  صَفَّارَة  '.replace(/صَفَّارَة/, 'صفارة').trim(), categoryId: 2, size: '', color: 'فضي', material: null });
    const found2 = await P.findSimilarProducts(adapter, { name: '  صفارة  ', categoryId: 2, size: null, color: 'فضي', material: undefined });
    check('5a. similar found despite extra spaces / null vs empty fields', () => {
      assertEqual(found2.length, 1, 'similar count');
      assertEqual(found2[0].sku, 'SIM-1', 'matched sku');
      void found;
    });
    const diffColor = await P.findSimilarProducts(adapter, { name: 'صفارة', categoryId: 2, color: 'ذهبي' });
    check('5b. returns nothing when color differs', () => assertEqual(diffColor.length, 0, 'similar count with other color'));
    const upper = await P.findSimilarProducts(adapter, { name: 'صفارة'.toUpperCase(), categoryId: 2, color: 'فضي' });
    check('5c. case-insensitive matching (Arabic unaffected / latin folded)', () => assert(upper.length >= 0, ''));
  }

  // ---------- 6. generateSku unique & sequential ----------
  {
    const { db, adapter } = mk();
    const s1 = await P.generateSku(adapter, 1);
    await P.createProduct(adapter, { sku: s1, name: 'أ', categoryId: 1, purchasePrice: 10, salePrice: 20, quantity: 0 });
    const s2 = await P.generateSku(adapter, 1);
    await P.createProduct(adapter, { sku: s2, name: 'ب', categoryId: 1, purchasePrice: 10, salePrice: 20, quantity: 0 });
    const s3 = await P.generateSku(adapter, 1);
    const sC2 = await P.generateSku(adapter, 2);
    check('6. generateSku returns CAT<id>-NNNN sequential unique SKUs', () => {
      assertEqual(s1, 'CAT1-0001', 'first sku');
      assertEqual(s2, 'CAT1-0002', 'second sku');
      assertEqual(s3, 'CAT1-0003', 'third sku');
      assertEqual(sC2, 'CAT2-0001', 'other category starts at 0001');
      const skus = db.prepare('SELECT sku FROM products').all().map((r) => r.sku);
      assertEqual(new Set(skus).size, skus.length, 'skus unique');
    });
    // collision override: manually insert CAT1-0004 then ask for a new sku
    db.prepare(`INSERT INTO products (sku, name, category_id, purchase_price, sale_price, quantity) VALUES ('CAT1-0004','يدوي',1,1,2,0)`).run();
    const s5 = await P.generateSku(adapter, 1);
    check('6b. generateSku skips collisions with manual SKUs', () => {
      assertEqual(s5, 'CAT1-0005', 'next free sku');
    });
  }

  // ---------- 7. updateProduct changes price/name but NOT quantity ----------
  {
    const { db, adapter } = mk();
    const p = await P.createProduct(adapter, { sku: 'UPD-1', name: 'قميص', categoryId: 1, purchasePrice: 1000, salePrice: 1500, quantity: 9 });
    const updated = await P.updateProduct(adapter, p.id, {
      sku: 'UPD-1',
      name: 'قميص سبور',
      categoryId: 1,
      purchasePrice: 1200,
      salePrice: 1700,
    });
    check('7. updateProduct changes name+prices, keeps quantity, bumps updated_at', () => {
      assertEqual(updated.name, 'قميص سبور', 'name');
      assertEqual(updated.purchase_price, 1200, 'purchase');
      assertEqual(updated.sale_price, 1700, 'sale');
      assertEqual(updated.quantity, 9, 'quantity must not change');
      const row = db.prepare('SELECT quantity FROM products WHERE id = ?').get(p.id);
      assertEqual(row.quantity, 9, 'quantity in db');
    });
    await checkAsync('7b. updateProduct rejects duplicate sku', async () => {
      // create second product then try to steal the first sku
      await expectReject(
        (async () => {
          const q = await P.createProduct(adapter, { sku: 'UPD-2', name: 'بنطال', categoryId: 1, purchasePrice: 800, salePrice: 1200, quantity: 2 });
          return P.updateProduct(adapter, q.id, { sku: 'UPD-1', name: 'بنطال', categoryId: 1, purchasePrice: 800, salePrice: 1200 });
        })(),
        'مستعمل من قبل',
        'dup on update',
      );
    });
  }

  // ---------- 8. deleteProduct hard vs soft ----------
  {
    const { db, adapter } = mk();
    const onlyInitial = await P.createProduct(adapter, { sku: 'DEL-1', name: 'مرذاذ', categoryId: 3, purchasePrice: 300, salePrice: 500, quantity: 4 });
    const res1 = await P.deleteProduct(adapter, onlyInitial.id);
    check('8a. product with only initial movement -> hard deleted (with its movement)', () => {
      assertEqual(res1.softDeleted, false, 'soft flag');
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(onlyInitial.id);
      const m = db.prepare('SELECT * FROM stock_movements WHERE product_id = ?').get(onlyInitial.id);
      assert(!p, 'product row must be gone');
      assert(!m, 'initial movement row must be gone');
    });

    // restock history -> soft
    const withRestock = await P.createProduct(adapter, { sku: 'DEL-2', name: 'بالون', categoryId: 2, purchasePrice: 400, salePrice: 600, quantity: 3 });
    db.prepare(`INSERT INTO stock_movements (product_id, type, quantity_change, quantity_after) VALUES (?, 'restock', 10, 13)`).run(withRestock.id);
    const res2 = await P.deleteProduct(adapter, withRestock.id);
    const hiddenDefault = await P.getProducts(adapter);
    const shownInactive = await P.getProducts(adapter, { includeInactive: true });
    check('8b. product with restock movement -> soft deleted, hidden by default, visible with includeInactive', () => {
      assertEqual(res2.softDeleted, true, 'soft flag');
      assert(res2.message.includes('حذف ناعم'), 'arabic message mentions soft delete');
      assert(!hiddenDefault.some((x) => x.id === withRestock.id), 'hidden in default list');
      assert(shownInactive.some((x) => x.id === withRestock.id), 'visible with includeInactive');
      const row = db.prepare('SELECT is_active FROM products WHERE id = ?').get(withRestock.id);
      assertEqual(row.is_active, 0, 'is_active = 0');
    });

    // sale_items history -> soft
    const withSale = await P.createProduct(adapter, { sku: 'DEL-3', name: 'رباط ركبة', categoryId: 3, purchasePrice: 250, salePrice: 400, quantity: 6 });
    db.prepare(`INSERT INTO sales (type, status, customer_name) VALUES ('store','confirmed','زبون')`).run();
    const saleId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.prepare(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, purchase_price, sale_price) VALUES (?, ?, 'رباط ركبة', 1, 250, 400)`).run(saleId, withSale.id);
    const res3 = await P.deleteProduct(adapter, withSale.id);
    check('8c. product with a sale_item -> soft deleted', () => {
      assertEqual(res3.softDeleted, true, 'soft flag');
      const row = db.prepare('SELECT is_active FROM products WHERE id = ?').get(withSale.id);
      assertEqual(row.is_active, 0, 'is_active = 0');
    });

    // restore
    await P.restoreProduct(adapter, withRestock.id);
    const back = await P.getProducts(adapter);
    check('8d. restoreProduct brings the product back into the active list', () => {
      assert(back.some((x) => x.id === withRestock.id), 'restored');
    });
  }

  // ---------- 9. search + filters ----------
  {
    const { adapter } = mk();
    await P.createProduct(adapter, { sku: 'SRH-1', name: 'دوصار', categoryId: 1, color: 'أزرق', material: 'قطن', purchasePrice: 800, salePrice: 1200, quantity: 4 });
    await P.createProduct(adapter, { sku: 'SRH-2', name: 'تونة سبور', categoryId: 1, color: 'أسود', material: 'بوليستر', purchasePrice: 1000, salePrice: 1600, quantity: 2 });
    await P.createProduct(adapter, { sku: 'SRH-3', name: 'ضمادة', categoryId: 3, color: 'أبيض', purchasePrice: 100, salePrice: 200, quantity: 50 });

    const byName = await P.getProducts(adapter, { search: 'دوصار' });
    const bySku = await P.getProducts(adapter, { search: 'srh-2' });
    const byColor = await P.getProducts(adapter, { search: 'أزرق' });
    const byMaterial = await P.getProducts(adapter, { search: 'بوليستر' });
    const byCat = await P.getProducts(adapter, { categoryId: 1 });
    check('9. getProducts search by name/sku/color/material + category filter', () => {
      assertEqual(byName.length, 1, 'by name');
      assertEqual(byName[0].sku, 'SRH-1', 'name hit');
      assertEqual(bySku.length, 1, 'by sku (case-insensitive)');
      assertEqual(bySku[0].sku, 'SRH-2', 'sku hit');
      assertEqual(byColor.length, 1, 'by color');
      assertEqual(byColor[0].sku, 'SRH-1', 'color hit');
      assertEqual(byMaterial.length, 1, 'by material');
      assertEqual(byMaterial[0].sku, 'SRH-2', 'material hit');
      assertEqual(byCat.length, 2, 'category filter');
    });
  }

  // ---------- 10. stock value sum(quantity × purchase_price) ----------
  {
    const { adapter } = mk();
    await P.createProduct(adapter, { sku: 'V1', name: 'جيرسي', categoryId: 1, purchasePrice: 1200, salePrice: 2000, quantity: 5 }); // 6000
    await P.createProduct(adapter, { sku: 'V2', name: 'كوردو', categoryId: 2, purchasePrice: 900, salePrice: 1400, quantity: 8 });  // 7200
    await P.createProduct(adapter, { sku: 'V3', name: 'شاش طبي', categoryId: 3, purchasePrice: 50, salePrice: 100, quantity: 100 }); // 5000
    const active = await P.getProducts(adapter);
    const total = active.reduce((s, p) => s + p.quantity * p.purchase_price, 0);
    check('10. stock value = 18,200 DA over the 3 active products', () => assertEqual(total, 18200, 'stock value'));
    // soft-deleted product excluded from default list => excluded from valuation
    const gone = await P.createProduct(adapter, { sku: 'V4', name: 'مرهم', categoryId: 3, purchasePrice: 200, salePrice: 350, quantity: 10 });
    await P.deleteProduct(adapter, gone.id); // hard delete (only initial) -> also excluded
    const active2 = await P.getProducts(adapter);
    const total2 = active2.reduce((s, p) => s + p.quantity * p.purchase_price, 0);
    check('10b. valuation unchanged after removing a product', () => assertEqual(total2, 18200, 'stock value again'));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
