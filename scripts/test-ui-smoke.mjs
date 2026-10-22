#!/usr/bin/env node
// Static smoke test for the products UI (no browser needed).
import { readFileSync, existsSync } from 'node:fs';
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

// RTL logical utilities only (no physical mr-/ml-/pl-/pr- class prefixes)
const rtlViolations = [...allUi.matchAll(/className="[^"]*\b(?:mr|ml|pl|pr)-[\d.]/g)];
check('no physical margin/padding utilities (mr-, ml-, pl-, pr-)', rtlViolations.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
