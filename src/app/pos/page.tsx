"use client";

// ===== POS page: in-store sales (cashier style) =====
// Stock is decreased only through createStoreSale -> decreaseStock (same transaction).

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ScanSearch, Trash2, Plus, Minus } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { appDb } from "@/lib/db";
import { getSettings, type ShopSettings } from "@/services/settings";
import { buildInvoiceHtml, printInvoice } from "@/lib/invoice";
import { formatMoney, formatDateShort } from "@/lib/format";
import { SALE_STATUS_BADGE, SALE_STATUS_LABELS } from "@/lib/labels";
import type { Category, Product } from "@/types";
import { getProducts } from "@/services/products";
import { listCategories } from "@/services/dbAdapter";
import { createStoreSale, cancelStoreSale, getSales, getSaleById, type SaleWithItems } from "@/services/sales";

interface CartLine {
  productId: number;
  name: string;
  sku: string;
  maxQty: number;
  quantity: number;
  unitPrice: number;
  purchasePrice: number;
}

const intOr0 = (v: string) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export default function PosPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [catFilter, setCatFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("0");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [todaySales, setTodaySales] = useState<SaleWithItems[]>([]);
  const [shopInfo, setShopInfo] = useState<ShopSettings | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SaleWithItems | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadToday = useCallback(async () => {
    try {
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const sales = await getSales(appDb, { type: "store", dateFrom: iso, limit: 50 });
      setTodaySales(sales);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      listCategories(appDb).then(setCategories).catch(console.error);
      void loadToday();
      getSettings(appDb).then(setShopInfo).catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, [loadToday]);

  // Live product search (name / sku / color)
  useEffect(() => {
    const t = setTimeout(async () => {
      const q = search.trim();
      if (!q) {
        setResults([]);
        return;
      }
      try {
        const found = await getProducts(appDb, {
          search: q,
          categoryId: catFilter === "all" ? undefined : Number(catFilter),
        });
        setResults(found);
      } catch (e) {
        console.error(e);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [search, catFilter]);

  const addProduct = useCallback((p: Product) => {
    if (p.quantity <= 0 || !p.is_active) {
      toast.warning(`المنتج «${p.name}» غير متوفر في المخزون.`);
      return;
    }
    setLines((prev) => {
      const found = prev.find((l) => l.productId === p.id);
      if (found) {
        if (found.quantity + 1 > p.quantity) {
          toast.warning(`المتوفر من «${p.name}» هو ${p.quantity} فقط.`);
          return prev;
        }
        return prev.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1, maxQty: p.quantity } : l));
      }
      return [...prev, { productId: p.id, name: p.name, sku: p.sku, maxQty: p.quantity, quantity: 1, unitPrice: p.sale_price, purchasePrice: p.purchase_price }];
    });
  }, []);

  const changeQty = (productId: number, delta: number) => {
    setLines((prev) =>
      prev.flatMap((l) => {
        if (l.productId !== productId) return [l];
        const q = l.quantity + delta;
        if (q < 1) return [];
        if (q > l.maxQty) {
          toast.warning(`المتوفر هو ${l.maxQty} قطعة فقط.`);
          return [l];
        }
        return [{ ...l, quantity: q }];
      })
    );
  };

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const cost = lines.reduce((s, l) => s + l.quantity * l.purchasePrice, 0);
  const disc = intOr0(discount);
  const total = Math.max(0, subtotal - disc);
  const profit = total - cost;

  const confirmSale = useCallback(async () => {
    if (lines.length === 0) {
      toast.warning("السلة فارغة. أضف منتجات أولا.");
      return;
    }
    if (disc > subtotal) {
      toast.error("خصم لا يمكن أن يكون أكبر من إجمالي الفاتورة.");
      return;
    }
    setSaving(true);
    try {
      const res = await createStoreSale(appDb, {
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
        discount: disc,
        customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        note: note.trim() || null,
      });
      toast.success(`تم البيع رقم ${res.saleId} — الإجمالي ${formatMoney(res.total)} (الربح ${formatMoney(res.profit)})`);
      setLines([]);
      setDiscount("0");
      setCustomerName("");
      setCustomerPhone("");
      setNote("");
      setSearch("");
      setResults([]);
      void loadToday();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر تسجيل البيع.");
    } finally {
      setSaving(false);
    }
  }, [lines, disc, subtotal, customerName, customerPhone, note, loadToday]);

  // Shortcuts: F2 focuses search, F9 confirms sale
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F9") {
        e.preventDefault();
        if (lines.length > 0 && !saving) void confirmSale();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmSale, lines.length, saving]);

  const doPrint = async (saleId: number) => {
    try {
      const sale = await getSaleById(appDb, saleId);
      if (!sale) return toast.error("تعذر تحميل الفاتورة");
      const shop = shopInfo ?? await getSettings(appDb);
      await printInvoice(buildInvoiceHtml(sale, shop));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الطباعة.");
    }
  };

  const doCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancelStoreSale(appDb, cancelTarget.id, "إلغاء من واجهة المحل");
      toast.success(`تم إلغاء الفاتورة رقم ${cancelTarget.id} وإرجاع الكميات.`);
      setCancelTarget(null);
      void loadToday();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الإلغاء.");
    }
  };

  return (
    <>
      <PageHeader title="البيع في المحل" description="تسجيل عمليات البيع النقدية (POS)" />

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Right side (RTL start): product search */}
        <Card className="lg:col-span-3">
          <CardContent className="pt-6">
            <div className="relative">
              <ScanSearch className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const exact = results.find((p) => p.sku.toLowerCase() === search.trim().toLowerCase());
                    if (exact) {
                      addProduct(exact);
                      setSearch("");
                      setResults([]);
                    } else if (results.length === 1) {
                      addProduct(results[0]);
                      setSearch("");
                      setResults([]);
                    }
                  }
                }}
                placeholder="ابحث بالاسم أو الباركود ثم Enter… (F2)"
                className="pe-10"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant={catFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setCatFilter("all")}>
                الكل
              </Button>
              {categories.map((c) => (
                <Button key={c.id} variant={catFilter === String(c.id) ? "default" : "outline"} size="sm" onClick={() => setCatFilter(String(c.id))}>
                  {c.name}
                </Button>
              ))}
            </div>
            <div className="mt-4 max-h-[26rem] space-y-2 overflow-y-auto">
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!p.is_active || p.quantity <= 0}
                  onClick={() => addProduct(p)}
                  className={`flex w-full items-center justify-between rounded-lg border p-3 text-start transition-colors ${
                    p.is_active && p.quantity > 0 ? "hover:bg-accent" : "cursor-not-allowed opacity-50"
                  }`}
                >
                  <span>
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.sku}
                      {p.size ? ` • ${p.size}` : ""}
                      {p.color ? ` • ${p.color}` : ""} • المتوفر: {p.quantity}
                    </span>
                  </span>
                  <span className="font-semibold text-green-700">{formatMoney(p.sale_price)}</span>
                </button>
              ))}
              {search.trim() && results.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">لا توجد منتجات مطابقة للبحث.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Left side: cart */}
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <h3 className="mb-3 font-semibold">السلة</h3>
            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                السلة فارغة. اختر منتجا من القائمة لإضافته.
              </p>
            ) : (
              <div className="space-y-3">
                {lines.map((l) => (
                  <div key={l.productId} className="rounded-lg border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{l.name}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => setLines((prev) => prev.filter((x) => x.productId !== l.productId))} aria-label="حذف من السلة">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => changeQty(l.productId, -1)} aria-label="إنقاص">
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-8 text-center text-sm">{l.quantity}</span>
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => changeQty(l.productId, 1)} aria-label="زيادة">
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Input
                        className="h-7 w-24 text-sm"
                        inputMode="numeric"
                        value={String(l.unitPrice)}
                        onChange={(e) => {
                          const v = Number.parseInt(e.target.value, 10);
                          setLines((prev) => prev.map((x) => (x.productId === l.productId ? { ...x, unitPrice: Number.isFinite(v) && v >= 0 ? v : 0 } : x)));
                        }}
                        aria-label="سعر الوحدة"
                      />
                      <span className="ms-auto text-sm font-semibold">{formatMoney(l.quantity * l.unitPrice)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span>المجموع الفرعي</span><span>{formatMoney(subtotal)}</span></div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="pos-disc" className="font-normal">الخصم</Label>
                <Input id="pos-disc" className="h-8 w-28 text-sm" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d]/g, ""))} />
              </div>
              <div className="flex justify-between text-base font-bold"><span>الإجمالي</span><span>{formatMoney(total)}</span></div>
              <div className="flex justify-between text-green-700"><span>الربح المتوقع</span><span>{formatMoney(profit)}</span></div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Input placeholder="اسم الزبون (اختياري)" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              <Input placeholder="الهاتف (اختياري)" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
            <Input className="mt-2" placeholder="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />

            <Button className="mt-4 w-full" size="lg" onClick={() => void confirmSale()} disabled={saving || lines.length === 0}>
              تأكيد البيع (F9)
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Today's sales */}
      <Card className="mt-6">
        <CardContent className="pt-6">
          <h3 className="mb-3 font-semibold">مبيعات اليوم</h3>
          {todaySales.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">لا توجد مبيعات اليوم بعد.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>فاتورة</TableHead>
                  <TableHead>الوقت</TableHead>
                  <TableHead>القطع</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الربح</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-end">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {todaySales.map((s) => (
                  <TableRow key={s.id} className={s.status === "cancelled" ? "line-through opacity-60" : ""}>
                    <TableCell>#{s.id}</TableCell>
                    <TableCell>{formatDateShort(s.created_at ?? "")}</TableCell>
                    <TableCell>{s.items.reduce((n, i) => n + i.quantity, 0)}</TableCell>
                    <TableCell>{formatMoney(s.total)}</TableCell>
                    <TableCell>{s.status === "cancelled" ? "—" : formatMoney(s.profit)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={SALE_STATUS_BADGE[s.status]}>{SALE_STATUS_LABELS[s.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      {s.status !== "cancelled" && (
                        <Button variant="outline" size="sm" className="me-2" onClick={() => void doPrint(s.id)}>
                          طباعة
                        </Button>
                      )}
                      {s.status === "confirmed" && (
                        <Button variant="outline" size="sm" onClick={() => setCancelTarget(s)}>
                          إلغاء
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Cancel confirmation */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إلغاء الفاتورة #{cancelTarget?.id}</DialogTitle>
            <DialogDescription>
              سيتم إرجاع الكميات إلى المخزون وتسجيل الحركة كـ«إرجاع». لن تُحسب هذه الفاتورة في الأرباح. هل أنت متأكد؟
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>تراجع</Button>
            <Button variant="destructive" onClick={() => void doCancel()}>إلغاء الفاتورة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
