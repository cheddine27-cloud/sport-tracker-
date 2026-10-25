// ===== Printable invoice HTML (Arabic RTL, A5 + 80mm receipt) =====

import type { SaleWithItems } from '@/services/sales';
import type { ShopSettings } from '@/services/settings';

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const money = (n: number) => `${(n ?? 0).toLocaleString('en-US')} دج`;

/** Build a self-contained printable Arabic RTL invoice. */
export function buildInvoiceHtml(sale: SaleWithItems, shop: ShopSettings): string {
  const rows = (sale.items ?? [])
    .map(
      (it, i) => `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(it.product_name)}</td>
        <td>${it.quantity}</td>
        <td>${money(it.sale_price)}</td>
        <td>${money(it.quantity * it.sale_price)}</td>
      </tr>`,
    )
    .join('\n');

  const customer = sale.customer_name
    ? `<div class="meta"><strong>الزبون:</strong> ${escapeHtml(sale.customer_name)}${sale.customer_phone ? ` — ${escapeHtml(sale.customer_phone)}` : ''}${sale.customer_address ? `<br/><strong>العنوان:</strong> ${escapeHtml(sale.customer_address)}` : ''}</div>`
    : '';

  const isStore = sale.type === 'store';
  const title = isStore ? 'فاتورة بيع' : 'طلب تصدير';
  const statusLabel = sale.status === 'confirmed' ? 'مؤكد' : sale.status === 'pending' ? 'قيد الانتظار' : 'ملغي';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${title} رقم ${sale.id}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Cairo', Tahoma, Arial, sans-serif; margin: 0; padding: 12mm; color: #111; background: #fff; }
  .shop { text-align: center; border-bottom: 2px solid #16a34a; padding-bottom: 8px; margin-bottom: 10px; }
  .shop h1 { margin: 0; font-size: 20px; }
  .shop .sub { font-size: 12px; color: #444; }
  .head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; }
  .badge { display: inline-block; border: 1px solid #666; border-radius: 6px; padding: 1px 8px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
  th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: right; }
  th { background: #f0fdf4; }
  .totals { margin-top: 10px; font-size: 14px; width: 100%; }
  .totals td { border: none; padding: 3px 6px; }
  .grand { font-weight: 700; font-size: 16px; border-top: 2px solid #111 !important; }
  .footer { margin-top: 16px; text-align: center; font-size: 12px; color: #444; border-top: 1px dashed #999; padding-top: 8px; }
  @media print {
    @page { size: A5; margin: 6mm; }
    body { padding: 0; }
    .receipt { max-width: 72mm; margin: 0 auto; }
  }
</style>
</head>
<body>
<div class="receipt">
  <div class="shop">
    <h1>${escapeHtml(shop.shopName)}</h1>
    <div class="sub">${[shop.shopAddress, shop.shopPhone].filter(Boolean).map(escapeHtml).join(' — ')}</div>
  </div>
  <div class="head">
    <div><strong>${title}</strong> رقم: ${sale.id}<br/>التاريخ: ${escapeHtml(sale.created_at ?? '')}</div>
    <div class="badge">${statusLabel}${isStore ? '' : sale.confirmed_at ? ` — تسليم: ${escapeHtml(sale.confirmed_at)}` : ''}</div>
  </div>
  ${customer}
  <table>
    <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tr><td>المجموع الفرعي</td><td style="text-align:left">${money(sale.subtotal)}</td></tr>
    ${sale.discount ? `<tr><td>الخصم</td><td style="text-align:left">- ${money(sale.discount)}</td></tr>` : ''}
    <tr class="grand"><td>الإجمالي المستحق</td><td style="text-align:left">${money(sale.total)}</td></tr>
  </table>
  ${sale.note ? `<div style="margin-top:8px;font-size:12px"><strong>ملاحظة:</strong> ${escapeHtml(sale.note)}</div>` : ''}
  <div class="footer">${escapeHtml(shop.invoiceFooter || 'شكرا لتعاملكم معنا')}</div>
</div>
</body>
</html>`;
}

/** Print through a hidden iframe (works inside the Tauri webview). */
export function printInvoice(html: string): Promise<void> {
  return new Promise((resolve) => {
    const old = document.getElementById('invoice-print-frame');
    if (old) old.remove();
    const frame = document.createElement('iframe');
    frame.id = 'invoice-print-frame';
    frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      try {
        frame.contentWindow!.focus();
        frame.contentWindow!.print();
      } finally {
        resolve();
      }
    }, 150);
  });
}
