"use client";

import { useEffect, useState } from "react";
import { Wand2, Layers, Plus, Trash2 } from "lucide-react";
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
  onSimilarFound?: (input: ProductInput, similar: Product) => Promise<boolean>;
}

interface VariantRow {
  size: string;
  color: string;
  quantity: string;
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
  const [isVariantMode, setIsVariantMode] = useState(false);
  const [variants, setVariants] = useState<VariantRow[]>([
    { size: "40", color: "أسود", quantity: "5" },
    { size: "41", color: "أسود", quantity: "5" },
    { size: "42", color: "أسود", quantity: "5" },
  ]);

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
        setIsVariantMode(false);
      } else {
        setForm(empty);
        setIsVariantMode(false);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [open, product]);

  const purchase = Number(form.purchasePrice) || 0;
  const sale = Number(form.salePrice) || 0;
  const unitProfit = sale - purchase;

  const handleGenerate = async () => {
    if (!form.categoryId) {
      toast.error("اختر القسم أولا لتوليد المعرف");
      return;
    }
    try {
      const sku = await generateSku(appDb, Number(form.categoryId));
      setForm((f) => ({ ...f, sku }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر توليد المعرف");
    }
  };

  const addVariantRow = () => {
    setVariants((prev) => [...prev, { size: "43", color: form.color || "أسود", quantity: "5" }]);
  };

  const removeVariantRow = (index: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const updateVariantRow = (index: number, field: keyof VariantRow, value: string) => {
    setVariants((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return toast.error("اسم المنتج مطلوب");
    if (!form.categoryId) return toast.error("اختر قسم المنتج");

    setSaving(true);
    try {
      if (!isEdit && isVariantMode && variants.length > 0) {
        // Multi-variant batch creation
        for (let i = 0; i < variants.length; i++) {
          const v = variants[i];
          const variantSku = `${form.sku || 'SKU'}-${v.size}-${i + 1}`;
          const input: ProductInput = {
            sku: variantSku,
            name: `${form.name.trim()} (${v.size} - ${v.color})`,
            categoryId: Number(form.categoryId),
            size: v.size.trim() || null,
            color: v.color.trim() || null,
            material: form.material.trim() || null,
            purchasePrice: Number(form.purchasePrice),
            salePrice: Number(form.salePrice),
            quantity: Number(v.quantity) || 0,
            lowStockThreshold: Number(form.lowStockThreshold) || 3,
          };
          await createProduct(appDb, input);
        }
        toast.success(`تم إنشاء ${variants.length} مقاسات وتشكيلات بنجاح!`);
      } else {
        // Single Product creation or update
        const input: ProductInput = {
          sku: form.sku.trim() || `SKU-${Date.now()}`,
          name: form.name.trim(),
          categoryId: Number(form.categoryId),
          size: form.size.trim() || null,
          color: form.color.trim() || null,
          material: form.material.trim() || null,
          purchasePrice: Number(form.purchasePrice),
          salePrice: Number(form.salePrice),
          quantity: Number(form.quantity),
          lowStockThreshold: Number(form.lowStockThreshold),
        };

        if (isEdit && product) {
          const { quantity: _q, ...rest } = input;
          await updateProduct(appDb, product.id, rest);
          toast.success("تم تحديث بيانات المنتج بنجاح");
        } else {
          await createProduct(appDb, input);
          toast.success("تمت إضافة المنتج بنجاح");
        }
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
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between text-base">
            <span>{isEdit ? "تعديل المنتج" : "إضافة منتج رياضي جديد"}</span>
            {!isEdit && (
              <Button
                type="button"
                size="sm"
                variant={isVariantMode ? "default" : "outline"}
                onClick={() => setIsVariantMode(!isVariantMode)}
                className="text-xs font-semibold gap-1.5"
              >
                <Layers className="size-3.5" />
                {isVariantMode ? "وضع المقاسات المتعددة (نشط)" : "تفعيل مصفوفة المقاسات والألوان"}
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Category & Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>القسم / الصنف</Label>
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

            <div className="grid gap-1.5">
              <Label htmlFor="p-name">اسم الموديل / المنتج</Label>
              <Input
                id="p-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="مثال: حذاء Nike Zoom أو تيشيرت Adidas"
              />
            </div>
          </div>

          {/* SKU */}
          <div className="grid gap-1.5">
            <Label htmlFor="p-sku">رمز الباركود / المعرف (SKU)</Label>
            <div className="flex gap-2">
              <Input
                id="p-sku"
                dir="ltr"
                className="text-start font-mono"
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                placeholder="NIKE-ZM-001"
              />
              {!isEdit && (
                <Button type="button" variant="outline" onClick={handleGenerate} className="shrink-0 gap-1">
                  <Wand2 className="size-3.5 text-emerald-400" />
                  توليد باركود
                </Button>
              )}
            </div>
          </div>

          {/* Prices & Profit Preview */}
          <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-muted/40 border border-border/50">
            <div className="grid gap-1.5">
              <Label htmlFor="p-purchase">سعر الشراء (دج)</Label>
              <Input
                id="p-purchase"
                type="number"
                min={0}
                value={form.purchasePrice}
                onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-sale">سعر البيع للزبون (دج)</Label>
              <Input
                id="p-sale"
                type="number"
                min={0}
                value={form.salePrice}
                onChange={(e) => setForm((f) => ({ ...f, salePrice: e.target.value }))}
              />
            </div>
            <div className="col-span-2 flex items-center justify-between text-xs pt-2 border-t border-border/40">
              <span className="text-muted-foreground">هامش الربح المتوقع للقطعة:</span>
              <span className={unitProfit >= 0 ? "font-bold text-emerald-400 font-mono" : "font-bold text-red-500 font-mono"}>
                {formatMoney(unitProfit)}
              </span>
            </div>
          </div>

          {/* Single variant vs Multiple Variants Matrix */}
          {!isVariantMode ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="p-size">المقاس</Label>
                <Input
                  id="p-size"
                  value={form.size}
                  onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
                  placeholder="42, L, XL..."
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-color">اللون</Label>
                <Input
                  id="p-color"
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  placeholder="أسود، أزرق..."
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-material">الخامة / النوع</Label>
                <Input
                  id="p-material"
                  value={form.material}
                  onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))}
                  placeholder="Polyester, قطن..."
                />
              </div>
              {!isEdit && (
                <div className="grid gap-1.5 col-span-2">
                  <Label htmlFor="p-qty">الكمية الابتدائية بالمخزن</Label>
                  <Input
                    id="p-qty"
                    type="number"
                    min={0}
                    value={form.quantity}
                    onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-emerald-400">مصفوفة التشكيلات (المقاسات والكميات):</Label>
                <Button type="button" size="sm" variant="ghost" onClick={addVariantRow} className="text-xs h-7 gap-1">
                  <Plus className="size-3.5" /> إضافة مقاس
                </Button>
              </div>
              <div className="space-y-2 max-h-44 overflow-y-auto pe-1">
                {variants.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="المقاس (41, M...)"
                      value={v.size}
                      onChange={(e) => updateVariantRow(i, "size", e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      placeholder="اللون"
                      value={v.color}
                      onChange={(e) => updateVariantRow(i, "color", e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      placeholder="الكمية"
                      value={v.quantity}
                      onChange={(e) => updateVariantRow(i, "quantity", e.target.value)}
                      className="h-8 text-xs w-24 text-center"
                    />
                    {variants.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeVariantRow(i)}
                        className="size-8 text-red-500 hover:text-red-400 shrink-0"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold">
            {saving ? "جارٍ الحفظ..." : isVariantMode ? `حفظ المقاسات (${variants.length})` : "حفظ المنتج"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
