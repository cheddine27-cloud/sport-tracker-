#!/usr/bin/env node
// Static smoke test for the products UI (no browser needed).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;

function check(name, cond) {
  if (cond) {
    console.log(`PASS  ${name}`);
    pass++;
  } else {
    console.log(`FAIL  ${name}`);
    fail++;
  }
}

const pagePath = join(root, 'src/app/products/page.tsx');
check('products/page.tsx exists', existsSync(pagePath));
const page = readFileSync(pagePath, 'utf8');

// Imports of services
check('imports @/services/products', page.includes("@/services/products"));
check('imports @/services/categories', page.includes("@/services/categories"));
check('client component', page.includes('"use client"') || page.includes("'use client'"));

// Required Arabic labels
const labels = [
  'إضافة منتج',
  'إدارة الأقسام',
  'الكل',
  'بحث بالاسم',
  'إظهار المحذوفة',
  'المعرف',
  'الاسم',
  'القسم',
  'المقاس',
  'اللون',
  'النوع',
  'سعر الشراء',
  'سعر البيع',
  'الكمية',
  'الحالة',
  'إجراءات',
  'تعديل',
  'حذف',
  'تزويد',
  'قارب على النفاد',
  'نفد',
  'لا توجد منتجات مطابقة',
  '/inventory?restock=',
];
for (const label of labels) {
  check(`label present: "${label}"`, page.includes(label));
}

// Similar-product dialog text lives somewhere in the UI code
const formPath = join(root, 'src/components/products/ProductFormDialog.tsx');
const catsPath = join(root, 'src/components/products/CategoriesDialog.tsx');
check('ProductFormDialog.tsx exists', existsSync(formPath));
check('CategoriesDialog.tsx exists', existsSync(catsPath));
const form = existsSync(formPath) ? readFileSync(formPath, 'utf8') : '';
const allUi = page + form + (existsSync(catsPath) ? readFileSync(catsPath, 'utf8') : '');
check('similar-product confirmation text', allUi.includes('هذا المنتج موجود مسبقا'));
check('increase-quantity button', allUi.includes('زيادة الكمية'));
check('add-anyway button', allUi.includes('إضافة كمنتج جديد على أي حال'));
check('generate SKU button', allUi.includes('توليد'));
check('expected unit profit', allUi.includes('الربح المتوقع للوحدة'));
check('initial quantity field', allUi.includes('الكمية الأولية'));
check('alert threshold field', allUi.includes('حد التنبيه'));

// No dynamic routes: no [id] folders under src/app
const badRoute = existsSync(join(root, 'src/app/products/[id]'));
check('no dynamic route /products/[id]', !badRoute);

// ===== Exports UI (src/app/exports/page.tsx + NewOrderDialog) =====
const exportsPath = join(root, 'src/app/exports/page.tsx');
const exportsSrc = existsSync(exportsPath) ? readFileSync(exportsPath, 'utf8') : '';
check('exports page exists', exportsSrc.length > 0);
check('exports page imports sales service', exportsSrc.includes('@/services/sales'));
check('exports page uses openUrl (opener plugin)', exportsSrc.includes('@tauri-apps/plugin-opener'));
check('exports page uses phone helper', exportsSrc.includes('@/lib/phone'));
for (const label of ['الصادرات', 'طلب جديد', 'قيد الانتظار', 'مؤكد', 'ملغي', 'تأكيد التسليم', 'تفاصيل', 'الإيراد المتوقع', 'الربح المتوقع']) {
  check(`exports label "${label}"`, exportsSrc.includes(label));
}
check('no dynamic route /exports/[id]', !existsSync(join(root, 'src/app/exports/[id]')));

const nodPath = join(root, 'src/components/exports/NewOrderDialog.tsx');
const nodSrc = existsSync(nodPath) ? readFileSync(nodPath, 'utf8') : '';
check('NewOrderDialog exists and is real (not placeholder)', nodSrc.includes('createOutsideSale'));
check('NewOrderDialog imports getProducts', nodSrc.includes('getProducts'));
check('NewOrderDialog save button label', nodSrc.includes('حفظ الطلب'));
check('NewOrderDialog has no ComingSoon', !nodSrc.includes('قريبا'));

// ===== Expenses UI (src/app/expenses/page.tsx) =====
const expensesPath = join(root, 'src/app/expenses/page.tsx');
const expensesSrc = existsSync(expensesPath) ? readFileSync(expensesPath, 'utf8') : '';
check('expenses page exists', expensesSrc.length > 0);
check('expenses page is not a placeholder', !expensesSrc.includes('ComingSoon'));
check('expenses page imports expenses service', expensesSrc.includes('@/services/expenses'));
for (const label of ['المصاريف والأرباح', 'تكلفة المخزون الحالي', 'إجمالي المبيعات', 'تكلفة المبيعات', 'الربح الإجمالي', 'المصاريف الإضافية', 'صافي الربح', 'حسب المنتج', 'مصاريف إضافية', 'هذا الأسبوع']) {
  check(`expenses label "${label}"`, expensesSrc.includes(label));
}
check('no dynamic route /expenses/[id]', !existsSync(join(root, 'src/app/expenses/[id]')));

// ===== Statistics UI (src/app/statistics/page.tsx) =====
const statsPath = join(root, 'src/app/statistics/page.tsx');
const statsSrc = existsSync(statsPath) ? readFileSync(statsPath, 'utf8') : '';
check('statistics page exists', statsSrc.length > 0);
check('statistics page is not a placeholder', !statsSrc.includes('ComingSoon'));
check('statistics page imports statistics service', statsSrc.includes('@/services/statistics'));
check('statistics page uses recharts', statsSrc.includes("'recharts'"));
for (const label of ['الإحصائيات', 'مجموع البيع في المحل', 'مجموع البيع خارج المحل', 'إجمالي المبيعات', 'صافي الربح', 'طلبات قيد الانتظار', 'أكثر المنتجات مبيعا', 'منتجات راكدة', 'تنبيهات المخزون', 'هذه السنة']) {
  check(`statistics label "${label}"`, statsSrc.includes(label));
}
check('no dynamic route /statistics/[id]', !existsSync(join(root, 'src/app/statistics/[id]')));

// ===== POS UI (src/app/pos/page.tsx) =====
const posPath = join(root, 'src/app/pos/page.tsx');
const posSrc = existsSync(posPath) ? readFileSync(posPath, 'utf8') : '';
check('pos page exists', posSrc.length > 0);
check('pos page is not a placeholder', !posSrc.includes('ComingSoon'));
check('pos page imports sales service', posSrc.includes('@/services/sales'));
check('pos page calls createStoreSale', posSrc.includes('createStoreSale'));
for (const label of ['البيع في المحل', 'تأكيد البيع', 'مبيعات اليوم', 'السلة', 'إلغاء']) {
  check(`pos label "${label}"`, posSrc.includes(label));
}
check('no dynamic route /pos/[id]', !existsSync(join(root, 'src/app/pos/[id]')));

// ===== Distributors UI (src/app/distributors/page.tsx) =====
const distPath = join(root, 'src/app/distributors/page.tsx');
const distSrc = existsSync(distPath) ? readFileSync(distPath, 'utf8') : '';
check('distributors page exists', distSrc.length > 0);
check('distributors page is not a placeholder', !distSrc.includes('ComingSoon'));
check('distributors page imports distributors service', distSrc.includes('@/services/distributors'));
check('distributors page imports openUrl from plugin-opener', distSrc.includes('@tauri-apps/plugin-opener') && distSrc.includes('openUrl'));
check('distributors page imports phone helper', distSrc.includes('@/lib/phone'));
for (const label of ['الموزعون', 'إضافة موزع', 'واتساب']) {
  check(`distributors label "${label}"`, distSrc.includes(label));
}
// "رسالة فارغة" lives in the shared templates (src/lib/labels.ts), used by the page dropdown.
const labelsSrc = readFileSync(join(root, 'src/lib/labels.ts'), 'utf8');
check('distributors page uses WHATSAPP_MESSAGE_TEMPLATES', distSrc.includes('WHATSAPP_MESSAGE_TEMPLATES'));
check('empty-message template label "رسالة فارغة" in labels.ts', labelsSrc.includes('رسالة فارغة'));
check('no dynamic route /distributors/[id]', !existsSync(join(root, 'src/app/distributors/[id]')));

// RTL logical utilities only (no physical mr-/ml-/pl-/pr- class prefixes)
const rtlViolations = [...allUi.matchAll(/className="[^"]*\b(?:mr|ml|pl|pr)-[\d.]/g)];
check('no physical margin/padding utilities (mr-, ml-, pl-, pr-)', rtlViolations.length === 0);

// ===== Stage 10: settings, dashboard, invoice printing =====
const setPath = join(root, 'src/app/settings/page.tsx');
const setSrc = readFileSync(setPath, 'utf8');
check('settings page is not a placeholder', !setSrc.includes('ComingSoon'));
check('settings page imports settings service', setSrc.includes('@/services/settings'));
check('settings page imports backup ops', setSrc.includes('@/lib/backupOps'));
for (const label of ['الإعدادات', 'نسخة احتياطية الآن', 'استعادة نسخة', 'فحص سلامة المخزون', 'معلومات المحل']) {
  check(`settings label "${label}"`, setSrc.includes(label));
}
const dashPath = join(root, 'src/app/page.tsx');
const dashSrc = readFileSync(dashPath, 'utf8');
check('dashboard is not a placeholder', !dashSrc.includes('ComingSoon'));
check('dashboard imports statistics service', dashSrc.includes('@/services/statistics'));
check('dashboard imports sales service', dashSrc.includes('@/services/sales'));
check('dashboard imports stock service', dashSrc.includes('@/services/stock'));
check('dashboard uses recharts', dashSrc.includes('recharts'));
for (const label of ['لوحة التحكم', 'مبيعات اليوم', 'ربح اليوم', 'قيمة المخزون', 'طلبات قيد الانتظار', 'بيع جديد', 'طلب جديد', 'إضافة منتج', 'منتجات تحتاج تزويدا']) {
  check(`dashboard label "${label}"`, dashSrc.includes(label));
}
const invPath = join(root, 'src/lib/invoice.ts');
const invSrc = readFileSync(invPath, 'utf8');
check('invoice builder exists with RTL html', invSrc.includes('buildInvoiceHtml') && invSrc.includes('dir="rtl"'));
check('invoice escapes html', invSrc.includes('escapeHtml'));
check('pos page has print button', posSrc.includes('طباعة') && posSrc.includes('@/lib/invoice'));
check('exports page has print button', exportsSrc.includes('طباعة الفاتورة') && exportsSrc.includes('@/lib/invoice'));
check('no ComingSoon anywhere in src/app pages', (() => {
  const files = readdirSync(join(root, 'src/app'), { recursive: true }).filter((f) => String(f).endsWith('page.tsx'));
  return files.every((f) => !readFileSync(join(root, 'src/app', String(f)), 'utf8').includes('ComingSoon'));
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
