(()=>{"use strict";module.exports=[69544,a=>{var b=a.i(64831);let c={name:"minus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}]]};c.node;let d=(0,b.f)(c);a.s(["f",0,d],69544)},92422,a=>{function b(a){return String(a??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}let c=a=>`${(a??0).toLocaleString("en-US")} دج`;a.s(["C",0,function(a,d){let e=(a.items??[]).map((a,d)=>`<tr>
        <td>${d+1}</td>
        <td>${b(a.product_name)}</td>
        <td>${a.quantity}</td>
        <td>${c(a.sale_price)}</td>
        <td>${c(a.quantity*a.sale_price)}</td>
      </tr>`).join("\n"),f=a.customer_name?`<div class="meta"><strong>الزبون:</strong> ${b(a.customer_name)}${a.customer_phone?` — ${b(a.customer_phone)}`:""}${a.customer_address?`<br/><strong>العنوان:</strong> ${b(a.customer_address)}`:""}</div>`:"",g="store"===a.type,h=g?"فاتورة بيع":"طلب تصدير",i="confirmed"===a.status?"مؤكد":"pending"===a.status?"قيد الانتظار":"ملغي";return`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${h} رقم ${a.id}</title>
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
    <h1>${b(d.shopName)}</h1>
    <div class="sub">${[d.shopAddress,d.shopPhone].filter(Boolean).map(b).join(" — ")}</div>
  </div>
  <div class="head">
    <div><strong>${h}</strong> رقم: ${a.id}<br/>التاريخ: ${b(a.created_at??"")}</div>
    <div class="badge">${i}${g?"":a.confirmed_at?` — تسليم: ${b(a.confirmed_at)}`:""}</div>
  </div>
  ${f}
  <table>
    <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
    <tbody>${e}</tbody>
  </table>
  <table class="totals">
    <tr><td>المجموع الفرعي</td><td style="text-align:left">${c(a.subtotal)}</td></tr>
    ${a.discount?`<tr><td>الخصم</td><td style="text-align:left">- ${c(a.discount)}</td></tr>`:""}
    <tr class="grand"><td>الإجمالي المستحق</td><td style="text-align:left">${c(a.total)}</td></tr>
  </table>
  ${a.note?`<div style="margin-top:8px;font-size:12px"><strong>ملاحظة:</strong> ${b(a.note)}</div>`:""}
  <div class="footer">${b(d.invoiceFooter||"شكرا لتعاملكم معنا")}</div>
</div>
</body>
</html>`},"N",0,function(a){return new Promise(b=>{let c=document.getElementById("invoice-print-frame");c&&c.remove();let d=document.createElement("iframe");d.id="invoice-print-frame",d.style.cssText="position:fixed;left:-9999px;top:0;width:0;height:0;border:0;",document.body.appendChild(d);let e=d.contentDocument;e.open(),e.write(a),e.close(),setTimeout(()=>{try{d.contentWindow.focus(),d.contentWindow.print()}finally{b()}},150)})}])}]})();

//# sourceMappingURL=_0eqfur4vjm-sa._.js.map