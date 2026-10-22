'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { appDb, getDb, query, withTransaction } from '@/lib/db';
import { getCategories, addCategory } from '@/services/categories';
import { createProduct, getProducts } from '@/services/products';
import type { Category } from '@/types';

const SAMPLE_PRODUCTS: {
  name: string;
  catKey: 'sports_clothes' | 'equipment' | 'paramedical';
  size?: string;
  color?: string;
  material?: string;
  purchase: number;
  sale: number;
  qty: number;
}[] = [
  { name: 'دوصار', catKey: 'sports_clothes', size: 'M', color: 'أسود', material: 'قطن', purchase: 1200, sale: 1800, qty: 25 },
  { name: 'تونة سبور', catKey: 'sports_clothes', size: 'L', color: 'أبيض', material: 'بوليستر', purchase: 900, sale: 1400, qty: 30 },
  { name: 'سيرفات', catKey: 'sports_clothes', size: 'XL', color: 'أزرق', material: 'جينز', purchase: 1500, sale: 2300, qty: 12 },
  { name: 'شورط رياضي', catKey: 'sports_clothes', size: 'M', color: 'أحمر', material: 'قطن', purchase: 700, sale: 1100, qty: 40 },
  { name: 'جاكيت رياضي', catKey: 'sports_clothes', size: 'L', color: 'أسود', material: 'فليس', purchase: 2200, sale: 3500, qty: 8 },
  { name: 'بالون قدم', catKey: 'equipment', color: 'أصفر', material: 'جلد صناعي', purchase: 800, sale: 1300, qty: 15 },
  { name: 'بالون سلة', catKey: 'equipment', color: 'برتقالي', material: 'مطاط', purchase: 1000, sale: 1600, qty: 10 },
  { name: 'كوردو', catKey: 'equipment', purchase: 300, sale: 550, qty: 50 },
  { name: 'صفارة', catKey: 'equipment', color: 'فضي', purchase: 150, sale: 300, qty: 20 },
  { name: 'مضرب تنس', catKey: 'equipment', material: 'كربون', purchase: 2500, sale: 3800, qty: 6 },
  { name: 'ضمادة', catKey: 'paramedical', purchase: 200, sale: 400, qty: 60 },
  { name: 'رباط ركبة', catKey: 'paramedical', size: 'موحد', color: 'أسود', purchase: 350, sale: 650, qty: 35 },
];

type Log = { ok: boolean; text: string };

export default function DbTestPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);

  const log = (ok: boolean, text: string) =>
    setLogs((prev) => [...prev, { ok, text }]);

  // ── Test 1: connection + list the 3 seeded categories ──────────────
  async function testConnection() {
    setBusy(true);
    try {
      await getDb();
      const cats = await getCategories();
      setCategories(cats);
      log(
        true,
        `الاتصال ناجح — عدد الفئات الافتراضية: ${cats.length} (${cats
          .map((c) => c.name)
          .join('، ')})`,
      );
    } catch (err) {
      log(false, `فشل الاتصال: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Test 2: add a test category and show it ────────────────────────
  async function testAddCategory() {
    setBusy(true);
    try {
      const name = `فئة اختبار ${Date.now()}`;
      const created = await addCategory(name);
      const cats = await getCategories();
      setCategories(cats);
      log(
        true,
        `تمت إضافة الفئة: #${created.id} "${created.name}" وعرضها في القائمة`,
      );
    } catch (err) {
      log(false, `فشل الإضافة: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Test 3: transaction rollback ───────────────────────────────────
  async function testTransaction() {
    setBusy(true);
    const marker = `txn-rollback-${Date.now()}`;
    try {
      await withTransaction(async (tx) => {
        await tx.execute(
          'INSERT INTO expenses (description, amount) VALUES (?1, ?2)',
          [marker, 999],
        );
        // Deliberate failure → must trigger ROLLBACK
        throw new Error('خطأ مقصود لاختبار التراجع (ROLLBACK)');
      });
      log(false, 'المعاملة لم ترمِ الخطأ المتوقع!');
    } catch {
      // Transaction correctly threw; verify the row did NOT persist.
      const rows = await query<{ id: number }>(
        'SELECT id FROM expenses WHERE description = ?1',
        [marker],
      );
      if (rows.length === 0) {
        log(
          true,
          'اختبار المعاملات ناجح: تم التراجع (ROLLBACK) والسجل لم يبقى في قاعدة البيانات',
        );
      } else {
        log(false, 'فشل التراجع: السجل بقي في قاعدة البيانات!');
      }
    } finally {
      setBusy(false);
    }
  }

  // ── Test 4: load sample data (skips existing names/SKUs) ───────────
  async function loadSampleData() {
    setBusy(true);
    try {
      const cats = await getCategories();
      const catByName = new Map(cats.map((c) => [c.name, c.id]));
      const wanted: Record<string, number | undefined> = {
        sports_clothes: catByName.get('ملابس رياضية'),
        equipment: catByName.get('عتاد رياضي'),
        paramedical: catByName.get('شبه طبي'),
      };
      const existing = await getProducts(appDb, { includeInactive: true });
      const existingNames = new Set(existing.map((p) => p.name.trim()));
      let added = 0;
      let skipped = 0;
      for (const s of SAMPLE_PRODUCTS) {
        if (existingNames.has(s.name)) {
          skipped++;
          continue;
        }
        const categoryId = wanted[s.catKey];
        if (!categoryId) {
          skipped++;
          continue;
        }
        try {
          const { generateSku } = await import('@/services/products');
          const sku = await generateSku(appDb, categoryId);
          await createProduct(appDb, {
            sku,
            name: s.name,
            categoryId,
            size: s.size ?? null,
            color: s.color ?? null,
            material: s.material ?? null,
            purchasePrice: s.purchase,
            salePrice: s.sale,
            quantity: s.qty,
            lowStockThreshold: 5,
          });
          added++;
        } catch {
          skipped++;
        }
      }
      log(true, `البيانات التجريبية: تمت إضافة ${added} منتج، تم تخطي ${skipped} موجود مسبقا`);
    } catch (err) {
      log(false, `فشل تحميل البيانات التجريبية: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function stockDemo() {
    setBusy(true);
    try {
      const { restockProduct, decreaseStock, getStockMovements } = await import('@/services/stock');
      const products = await getProducts(appDb, {});
      if (products.length < 2) {
        log(false, 'المخزون فارغ: اضغط زر تحميل بيانات تجريبية أولا');
        return;
      }
      const [p1, p2] = products;
      const r1 = await restockProduct(appDb, { productId: p1.id, quantity: 50 });
      log(true, `تزويد (${p1.name}): الكمية الجديدة ${r1.quantityAfter}`);
      const r2 = await appDb.transaction((tx) => decreaseStock(tx, { productId: p2.id, quantity: 5, type: 'sale_store', note: 'عرض تجريبي' }));
      log(true, `بيع (${p2.name}): الكمية المتبقية ${r2.quantityAfter}`);
      const movements = await getStockMovements(appDb, { limit: 5 });
      for (const m of movements) {
        log(true, `حركة: ${m.product_name} | ${m.type} | ${m.quantity_change > 0 ? '+' : ''}${m.quantity_change} | بعدها ${m.quantity_after}`);
      }
    } catch (err) {
      log(false, `فشل عرض المخزون: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportDemo() {
    setBusy(true);
    try {
      const { createOutsideSale, confirmOutsideSale, getSalesSummary } = await import('@/services/sales');
      const { getProductById } = await import('@/services/products');
      const products = await getProducts(appDb, {});
      if (products.length === 0) {
        log(false, 'المخزون فارغ: اضغط زر تحميل بيانات تجريبية أولا');
        return;
      }
      const p = products[0];
      if (p.quantity < 5) {
        log(false, `كمية (${p.name}) أقل من 5: المتوفر ${p.quantity}`);
        return;
      }
      const before = p.quantity;
      const res = await createOutsideSale(appDb, {
        items: [{ productId: p.id, quantity: 5 }],
        customerName: 'زبون تجريبي',
        customerPhone: '0555123456',
      });
      const afterCreate = await getProductById(appDb, p.id);
      log(true, `طلب تصدير #${res.saleId}: الإجمالي ${res.total} — الكمية: ${before} ← ${afterCreate?.quantity} (محجوزة)`);
      const pend = await getSalesSummary(appDb, { type: 'outside' });
      log(true, `قيد الانتظار: ${pend.pendingCount} | الإيراد المتوقع: ${pend.pendingExpectedRevenue} | الربح المتوقع: ${pend.pendingExpectedProfit}`);
      await confirmOutsideSale(appDb, res.saleId);
      const conf = await getSalesSummary(appDb, { type: 'outside' });
      const afterConfirm = await getProductById(appDb, p.id);
      log(true, `بعد التأكيد: إيراد ${conf.revenue} | ربح ${conf.profit} | الكمية ${afterConfirm?.quantity} (بدون تغيير)`);
    } catch (err) {
      log(false, `فشل عرض الصادرات: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>اختبار قاعدة البيانات (صفحة مؤقتة)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={testConnection} disabled={busy}>
            1. فحص الاتصال وعرض الفئات
          </Button>
          <Button onClick={testAddCategory} disabled={busy} variant="secondary">
            2. إضافة فئة اختبار
          </Button>
          <Button onClick={testTransaction} disabled={busy} variant="destructive">
            3. اختبار المعاملة (ROLLBACK)
          </Button>
          <Button onClick={loadSampleData} disabled={busy} variant="outline">
            4. تحميل بيانات تجريبية
          </Button>
          <Button onClick={stockDemo} disabled={busy} variant="secondary">
            5. Run stock demo
          </Button>
          <Button onClick={exportDemo} disabled={busy} variant="outline">
            6. Run export demo
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>الفئات الحالية</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {categories.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            categories.map((c) => (
              <Badge key={c.id} variant="secondary">
                {c.id}: {c.name}
              </Badge>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سجل الاختبارات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {logs.length === 0 ? (
            <span className="text-muted-foreground">لم تُشغّل أي اختبار بعد.</span>
          ) : (
            logs.map((l, i) => (
              <div
                key={i}
                className={`rounded-lg border p-3 text-sm ${
                  l.ok
                    ? 'border-green-300 bg-green-50 text-green-800'
                    : 'border-red-300 bg-red-50 text-red-800'
                }`}
              >
                {l.ok ? '✅' : '❌'} {l.text}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
