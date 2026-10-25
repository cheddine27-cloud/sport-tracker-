"use client";

import { useEffect, useState } from "react";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Category, Product } from "@/types";
import { appDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import {
  createProduct,
  findSimilarProducts,
  generateSku,
  updateProduct,
  validateProductInput,
  type ProductInput,
} from "@/services/products";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  product: Product | null; // null => add mode
  onSaved: () => void;
  /** Called before saving a NEW product when a similar one exists. Return true to add anyway. */
  onSimilarFound?: (input: ProductInput, similar: Product) => Promise<boolean>;
}

const empty = {
  categoryId: "",
  name: "",
  sku: "",
  size: "",
  color: "",
  material: "",
  purchasePrice: "0",
  salePrice: "0",
  quantity: "0",
  lowStockThreshold: "5",
};

export function ProductFormDialog({
  open,
  onOpenChange,
  categories,
  product,
  onSaved,
  onSimilarFound,
}: Props) {
  const isEdit = !!product;
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (product) {
        setForm({
          categoryId: String(product.category_id),
          name: product.name,
          sku: product.sku,
          size: product.size ?? "",
          color: product.color ?? "",
          material: product.material ?? "",
          purchasePrice: String(product.purchase_price),
          salePrice: String(product.sale_price),
          quantity: String(product.quantity),
          lowStockThreshold: String(product.low_stock_threshold),
        });
      } else {
        setForm(empty);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [open, product]);

  const toInput = (): ProductInput => ({
    sku: form.sku.trim(),
    name: form.name.trim(),
    categoryId: Number(form.categoryId),
    size: form.size.trim() || null,
    color: form.color.trim() || null,
    material: form.material.trim() || null,
    purchasePrice: Number(form.purchasePrice),
    salePrice: Number(form.salePrice),
    quantity: Number(form.quantity),
    lowStockThreshold: Number(form.lowStockThreshold),
  });

  const purchase = Number(form.purchasePrice) || 0;
  const sale = Number(form.salePrice) || 0;
  const unitProfit = sale - purchase;

  const handleGenerate = async () => {
    if (!form.categoryId) {
      toast.error("اختر القسم أولا");
      return;
    }
    try {
      const sku = await generateSku(appDb, Number(form.categoryId));
      setForm((f) => ({ ...f, sku }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر توليد المعرف");
    }
  };

  const handleSubmit = async () => {
    const input = toInput();
    try {
      validateProductInput(input, !isEdit);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "بيانات غير صالحة");
      return;
    }

    setSaving(true);
    try {
      if (!isEdit && onSimilarFound) {
        const similar = await findSimilarProducts(appDb, input);
        if (similar.length > 0) {
          const proceed = await onSimilarFound(input, similar[0]);
          if (!proceed) {
            setSaving(false);
            return;
          }
        }
      }

      if (isEdit && product) {
        const { quantity: _q, ...rest } = input;
        void _q;
        await updateProduct(appDb, product.id, rest);
        toast.success("تم تعديل المنتج بنجاح");
      } else {
        await createProduct(appDb, input);
        toast.success("تم إضافة المنتج بنجاح");
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حدث خطأ أثناء الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل منتج" : "إضافة منتج"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2 max-h-[65vh] overflow-y-auto pe-1">
          <div className="grid gap-2">
            <Label>القسم</Label>
            <Select
              value={form.categoryId}
              onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر القسم" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-name">اسم المنتج</Label>
            <Input
              id="p-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="مثال: دوصار"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-sku">معرف المنتج (SKU)</Label>
            <div className="flex gap-2">
              <Input
                id="p-sku"
                dir="ltr"
                className="text-start"
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                placeholder="CAT1-0001"
              />
              {!isEdit && (
                <Button type="button" variant="outline" onClick={handleGenerate}>
                  <Wand2 className="ms-2 h-4 w-4" />
                  توليد
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="p-size">المقاس</Label>
              <Input
                id="p-size"
                value={form.size}
                onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
                placeholder="اختياري"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-color">اللون</Label>
              <Input
                id="p-color"
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-material">النوع</Label>
              <Input
                id="p-material"
                value={form.material}
                onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))}
                placeholder="نوع القماش..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="p-purchase">سعر الشراء (دج)</Label>
              <Input
                id="p-purchase"
                type="number"
                min={0}
                step={1}
                value={form.purchasePrice}
                onChange={(e) =>
                  setForm((f) => ({ ...f, purchasePrice: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-sale">سعر البيع (دج)</Label>
              <Input
                id="p-sale"
                type="number"
                min={0}
                step={1}
                value={form.salePrice}
                onChange={(e) => setForm((f) => ({ ...f, salePrice: e.target.value }))}
              />
            </div>
          </div>

          <div className="rounded-lg bg-muted p-3 text-sm">
            الربح المتوقع للوحدة:{" "}
            <span
              className={
                unitProfit >= 0 ? "font-bold text-green-700" : "font-bold text-red-600"
              }
            >
              {formatMoney(unitProfit)}
            </span>
            {unitProfit < 0 && (
              <p className="mt-1 text-orange-600">
                ⚠️ تنبيه: سعر البيع أقل من سعر الشراء (لن يتم منع الحفظ).
              </p>
            )}
          </div>

          {!isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="p-qty">الكمية الأولية</Label>
                <Input
                  id="p-qty"
                  type="number"
                  min={0}
                  step={1}
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-threshold">حد التنبيه</Label>
                <Input
                  id="p-threshold"
                  type="number"
                  min={0}
                  step={1}
                  value={form.lowStockThreshold}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, lowStockThreshold: e.target.value }))
                  }
                />
              </div>
            </div>
          )}
          {isEdit && (
            <p className="text-xs text-muted-foreground">
              لا يمكن تعديل الكمية هنا — تُعدّل الكميات عبر المخزون (تزويد / حركة).
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
