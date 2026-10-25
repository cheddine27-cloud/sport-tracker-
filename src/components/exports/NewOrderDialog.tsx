'use client';

// ===== New outside-order dialog (exports) =====
// Creates a 'pending' order via createOutsideSale: stock is reserved immediately.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Minus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { appDb } from '@/lib/db';
import { getProducts } from '@/services/products';
import { createOutsideSale, type SaleLineInput } from '@/services/sales';
import type { Product } from '@/types';
import { formatMoney } from '@/lib/format';

interface CartLine {
  product: Product;
  quantity: number;
  unitPrice: number; // editable snapshot, integer >= 0
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

function toInt(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function NewOrderDialog({ open, onOpenChange, onCreated }: Props) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [note, setNote] = useState('');
  const [discountStr, setDiscountStr] = useState('0');

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setNote('');
    setDiscountStr('0');
    setSearch('');
    setResults([]);
    setLines([]);
  }, []);

  // Debounced product search (name / sku / color handled by the service).
  // All state updates happen inside the timeout callback, never synchronously in the effect body.
  useEffect(() => {
    if (!open) return;
    const q = search.trim();
    const t = setTimeout(async () => {
      if (!q) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const found = await getProducts(appDb, { search: q });
        setResults(found.slice(0, 12));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [open, search]);

  const addProduct = (p: Product) => {
    if (p.quantity <= 0) {
      toast.error(`المنتج "${p.name}" نفد من المخزون`);
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === p.id);
      if (existing) {
        if (existing.quantity + 1 > existing.product.quantity) {
          toast.warning(`لا توجد كمية كافية من "${p.name}". المتوفر: ${existing.product.quantity}`);
          return prev;
        }
        return prev.map((l) =>
          l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, { product: p, quantity: 1, unitPrice: p.sale_price }];
    });
    setSearch('');
    setResults([]);
  };

  const setQty = (id: number, qty: number) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.product.id !== id) return l;
        let q = Math.max(1, Math.trunc(qty));
        if (q > l.product.quantity) {
          toast.warning(`الكمية المتوفرة من "${l.product.name}" هي ${l.product.quantity} فقط`);
          q = l.product.quantity;
        }
        return { ...l, quantity: q };
      }),
    );
  };

  const setPrice = (id: number, priceStr: string) => {
    const n = Math.max(0, toInt(priceStr));
    setLines((prev) =>
      prev.map((l) => (l.product.id === id ? { ...l, unitPrice: n } : l)),
    );
  };

  const removeLine = (id: number) =>
    setLines((prev) => prev.filter((l) => l.product.id !== id));

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
    [lines],
  );
  const cost = useMemo(
    () => lines.reduce((s, l) => s + l.quantity * l.product.purchase_price, 0),
    [lines],
  );
  const discount = Math.min(Math.max(0, toInt(discountStr)), subtotal);
  const total = subtotal - discount;
  const expectedProfit = total - cost;

  const save = async () => {
    if (lines.length === 0) {
      toast.error('أضف منتجا واحدا على الأقل إلى الطلب');
      return;
    }
    const items: SaleLineInput[] = lines.map((l) => ({
      productId: l.product.id,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    }));
    setSaving(true);
    try {
      const res = await createOutsideSale(appDb, {
        items,
        discount,
        customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        customerAddress: customerAddress.trim() || null,
        note: note.trim() || null,
      });
      toast.success(
        `تم حفظ الطلب رقم ${res.saleId} — الإجمالي ${formatMoney(res.total)} (خُصمت الكميات من المخزون)`,
      );
      resetForm();
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      // Service errors are already Arabic — show them as-is
      toast.error(e instanceof Error ? e.message : 'تعذر حفظ الطلب');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>طلب تصدير جديد (يخصم من المخزون)</DialogTitle>
        </DialogHeader>

        {/* Customer */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="cust-name">اسم الزبون *</Label>
            <Input
              id="cust-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="مثال: محل النور"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cust-phone">الهاتف *</Label>
            <Input
              id="cust-phone"
              dir="ltr"
              className="text-start"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="0555123456"
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="cust-address">العنوان (اختياري)</Label>
            <Input
              id="cust-address"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="العنوان عند الحاجة"
            />
          </div>
        </div>

        {/* Product picker */}
        <div className="grid gap-2">
          <Label htmlFor="order-search">إضافة منتج</Label>
          <div className="relative">
            <Search className="absolute end-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="order-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو المعرف أو اللون..."
              className="pe-9"
            />
          </div>
          {searching && (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> جارٍ البحث...
            </p>
          )}
          {!!search.trim() && !searching && results.length === 0 && (
            <p className="text-xs text-muted-foreground">لا توجد نتائج مطابقة.</p>
          )}
          {results.length > 0 && (
            <ul className="border rounded-md divide-y max-h-48 overflow-y-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={p.quantity <= 0}
                    onClick={() => addProduct(p)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="flex flex-col items-start">
                      <span>{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.sku}</span>
                    </span>
                    <span className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">
                        متوفر: {p.quantity}
                      </span>
                      <span className="font-medium">{formatMoney(p.sale_price)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Lines */}
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground border-dashed border rounded-md p-4 text-center">
            لم تُضف منتجات بعد.
          </p>
        ) : (
          <div className="border rounded-md divide-y">
            {lines.map((l) => (
              <div key={l.product.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-40">
                  <p className="text-sm font-medium">{l.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    متوفر: {l.product.quantity} — سعر التكلفة: {formatMoney(l.product.purchase_price)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    onClick={() => setQty(l.product.id, l.quantity - 1)}
                    disabled={l.quantity <= 1}
                    aria-label="إنقاص الكمية"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <Input
                    className="h-7 w-14 text-center"
                    inputMode="numeric"
                    value={String(l.quantity)}
                    onChange={(e) => setQty(l.product.id, toInt(e.target.value) || 1)}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    onClick={() => setQty(l.product.id, l.quantity + 1)}
                    disabled={l.quantity >= l.product.quantity}
                    aria-label="زيادة الكمية"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  <Label className="text-xs text-muted-foreground" htmlFor={`price-${l.product.id}`}>
                    سعر الوحدة
                  </Label>
                  <Input
                    id={`price-${l.product.id}`}
                    className="h-7 w-24"
                    inputMode="numeric"
                    value={String(l.unitPrice)}
                    onChange={(e) => setPrice(l.product.id, e.target.value)}
                  />
                </div>
                <span className="text-sm font-medium w-24 text-end">
                  {formatMoney(l.quantity * l.unitPrice)}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-red-600"
                  onClick={() => removeLine(l.product.id)}
                  aria-label="حذف السطر"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Discount + note + totals */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="order-discount">الخصم (دج)</Label>
            <Input
              id="order-discount"
              inputMode="numeric"
              value={discountStr}
              onChange={(e) => setDiscountStr(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="order-note">ملاحظة (اختياري)</Label>
            <Input
              id="order-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ملاحظة حول الطلب"
            />
          </div>
        </div>

        <div className="rounded-md bg-muted p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">المجموع الفرعي:</span>
            <span>{formatMoney(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">الخصم:</span>
            <span>- {formatMoney(discount)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>الإجمالي:</span>
            <span>{formatMoney(total)}</span>
          </div>
          <div className="flex justify-between text-emerald-700">
            <span>الربح المتوقع:</span>
            <span>{formatMoney(expectedProfit)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إغلاق
          </Button>
          <Button onClick={save} disabled={saving || lines.length === 0}>
            {saving && <Loader2 className="ms-0 me-2 h-4 w-4 animate-spin" />}
            حفظ الطلب (يخصم من المخزون)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
