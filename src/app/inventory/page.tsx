"use client";

// ===== Inventory page: summary, current stock, restock, adjustment, movements =====

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Boxes, PackagePlus, ClipboardList, Search } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { appDb } from "@/lib/db";
import { formatMoney, formatDateShort } from "@/lib/format";
import { MOVEMENT_TYPE_BADGE, MOVEMENT_TYPE_LABELS, STOCK_STATUS_LABELS } from "@/lib/labels";
import type { Category, MovementType } from "@/types";
import {
  adjustStock,
  getInventoryRows,
  getInventorySummary,
  getStockMovements,
  restockMany,
  restockProduct,
  type InventoryRow,
  type InventorySummary,
  type MovementRow,
} from "@/services/stock";
import { listCategories } from "@/services/dbAdapter";

type Tab = "stock" | "movements";

const ALL_MOVEMENT_TYPES = Object.keys(MOVEMENT_TYPE_LABELS) as MovementType[];

function statusBadge(row: InventoryRow) {
  if (row.status === "out") return <Badge variant="destructive">{STOCK_STATUS_LABELS.out}</Badge>;
  if (row.status === "low") return <Badge className="bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100">{STOCK_STATUS_LABELS.low}</Badge>;
  return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">{STOCK_STATUS_LABELS.ok}</Badge>;
}

// ---------- Restock dialog ----------

interface RestockLine { key: number; productId: number | null; quantity: string; }

let lineKeyCounter = 0;
const nextLineKey = () => ++lineKeyCounter;

function RestockDialog({
  open,
  onOpenChange,
  products,
  presetProductId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: InventoryRow[];
  presetProductId?: number | null;
  onSaved: () => void;
}) {
  // The form is mounted only while the dialog is open and keyed by the preset,
  // so it always starts with fresh state (no setState needed inside effects).
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {open && <RestockForm key={`restock-${presetProductId ?? "none"}`} products={products} presetProductId={presetProductId} onSaved={onSaved} close={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RestockForm({
  products,
  presetProductId,
  onSaved,
  close,
}: {
  products: InventoryRow[];
  presetProductId?: number | null;
  onSaved: () => void;
  close: () => void;
}) {
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<RestockLine[]>([{ key: nextLineKey(), productId: presetProductId ?? null, quantity: "" }]);
  const [updatePrice, setUpdatePrice] = useState(false);
  const [newPrice, setNewPrice] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, search]);

  const selected = (line: RestockLine) => products.find((p) => p.id === line.productId) ?? null;

  const addLine = () => setLines((ls) => [...ls, { key: nextLineKey(), productId: null, quantity: "" }]);
  const removeLine = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const save = async () => {
    const items = lines
      .filter((l) => l.productId && Number(l.quantity) > 0 && Number.isInteger(Number(l.quantity)))
      .map((l) => ({ productId: l.productId as number, quantity: Number(l.quantity) }));
    if (items.length === 0 || items.length !== lines.length) {
      toast.error("اختر المنتج وأدخل كمية صحيحة في كل السطور");
      return;
    }
    let price: number | null = null;
    if (updatePrice) {
      price = Number(newPrice);
      if (!Number.isInteger(price) || price < 0) {
        toast.error("سعر الشراء الجديد يجب أن يكون عددا صحيحا");
        return;
      }
      if (items.length > 1) {
        toast.error("تحديث سعر الشراء متاح لسطر واحد فقط");
        return;
      }
    }
    setSaving(true);
    try {
      if (items.length === 1) {
        const r = await restockProduct(appDb, { ...items[0], newPurchasePrice: price, note: note.trim() || null });
        toast.success(`تم التزويد. الكمية الجديدة: ${r.quantityAfter}`);
      } else {
        await restockMany(appDb, items.map((i) => ({ ...i, note: note.trim() || null })));
        toast.success(`تم تزويد ${items.length} منتجات`);
      }
      close();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التزويد");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="size-5" /> تزويد المخزون
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute inset-y-0 my-auto size-4 text-muted-foreground start-3" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن منتج بالاسم أو المعرف..." className="ps-9" />
          </div>
          <div className="space-y-3 max-h-64 overflow-y-auto px-1">
            {lines.map((line, idx) => {
              const p = selected(line);
              const qty = Number(line.quantity) || 0;
              return (
                <div key={line.key} className="rounded-lg border p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={line.productId ? String(line.productId) : ""}
                      onValueChange={(v) => setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, productId: Number(v) } : l)))}
                    >
                      <SelectTrigger><SelectValue placeholder="اختر منتجا" /></SelectTrigger>
                      <SelectContent>
                        {filtered.map((prod) => (
                          <SelectItem key={prod.id} value={String(prod.id)}>
                            {prod.name} — {prod.sku} (متوفر: {prod.quantity})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min={1} step={1} inputMode="numeric"
                        value={line.quantity}
                        onChange={(e) => setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, quantity: e.target.value } : l)))}
                        placeholder="الكمية"
                      />
                      {lines.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removeLine(line.key)}>حذف</Button>
                      )}
                    </div>
                  </div>
                  {p && (
                    <p className="text-sm text-muted-foreground">
                      الكمية بعد التزويد: {p.quantity} + {qty} = <span className="font-semibold text-foreground">{p.quantity + qty}</span>
                    </p>
                  )}
                  {idx === 0 && lines.length === 1 && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={updatePrice} onChange={(e) => setUpdatePrice(e.target.checked)} className="size-4 accent-primary" />
                      تحديث سعر الشراء
                    </label>
                  )}
                  {idx === 0 && updatePrice && lines.length === 1 && (
                    <Input type="number" min={0} step={1} value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="سعر الشراء الجديد (دج)" />
                  )}
                </div>
              );
            })}
          </div>
          <Button variant="outline" size="sm" onClick={addLine}>+ إضافة سطر (تزويد عدة منتجات)</Button>
          <div>
            <Label htmlFor="restock-note">ملاحظة (اختياري)</Label>
            <Input id="restock-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: فاتورة المورّد رقم 12" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>إلغاء</Button>
          <Button onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ التزويد"}</Button>
        </DialogFooter>
    </>
  );
}

// ---------- Adjustment dialog ----------

function AdjustDialog({
  open,
  onOpenChange,
  products,
  presetProductId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: InventoryRow[];
  presetProductId?: number | null;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && <AdjustForm key={`adjust-${presetProductId ?? "none"}`} products={products} presetProductId={presetProductId} onSaved={onSaved} close={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AdjustForm({
  products,
  presetProductId,
  onSaved,
  close,
}: {
  products: InventoryRow[];
  presetProductId?: number | null;
  onSaved: () => void;
  close: () => void;
}) {
  const [productId, setProductId] = useState<number | null>(presetProductId ?? null);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const p = products.find((x) => x.id === productId) ?? null;
  const diff = p && counted !== "" ? Number(counted) - p.quantity : null;

  const save = async () => {
    if (!p) { toast.error("اختر منتجا"); return; }
    if (counted === "" || !Number.isInteger(Number(counted)) || Number(counted) < 0) {
      toast.error("أدخل الكمية المعدودة (عدد صحيح >= 0)");
      return;
    }
    if (!reason.trim()) { toast.error("السبب مطلوب عند تعديل الكمية"); return; }
    setSaving(true);
    try {
      const r = await adjustStock(appDb, { productId: p.id, newQuantity: Number(counted), reason: reason.trim() });
      toast.success(r.message);
      close();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التعديل");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="size-5" /> جرد / تعديل الكمية
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>المنتج</Label>
            <Select value={productId ? String(productId) : ""} onValueChange={(v) => setProductId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="اختر منتجا" /></SelectTrigger>
              <SelectContent>
                {products.map((prod) => (
                  <SelectItem key={prod.id} value={String(prod.id)}>{prod.name} — {prod.sku}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {p && (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-muted p-3 text-center">
                <p className="text-muted-foreground">الكمية الحالية</p>
                <p className="text-lg font-bold">{p.quantity}</p>
              </div>
              <div className="rounded-lg bg-muted p-3 text-center">
                <Label className="text-muted-foreground">الكمية المعدودة</Label>
                <Input type="number" min={0} step={1} value={counted} onChange={(e) => setCounted(e.target.value)} className="mt-1 text-center" />
              </div>
              <div className="rounded-lg bg-muted p-3 text-center">
                <p className="text-muted-foreground">الفرق</p>
                <p className={`text-lg font-bold ${diff == null ? "text-muted-foreground" : diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : ""}`}>
                  {diff == null ? "-" : diff > 0 ? `+${diff}` : diff}
                </p>
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="adjust-reason">السبب (مطلوب)</Label>
            <Input id="adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: تلف، خطأ في الجرد، سرقة..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>إلغاء</Button>
          <Button onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ الجرد"}</Button>
        </DialogFooter>
    </>
  );
}

// ---------- Movements ----------

function MovementsTable({ rows }: { rows: MovementRow[] }) {
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>التاريخ</TableHead>
            <TableHead>المنتج</TableHead>
            <TableHead>النوع</TableHead>
            <TableHead className="text-center">التغيير</TableHead>
            <TableHead className="text-center">الكمية بعدها</TableHead>
            <TableHead>ملاحظة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">لا توجد حركات مطابقة</TableCell></TableRow>
          )}
          {rows.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="whitespace-nowrap">{m.created_at ? formatDateShort(m.created_at) : "-"}</TableCell>
              <TableCell>{m.product_name} <span className="text-xs text-muted-foreground">({m.product_sku})</span></TableCell>
              <TableCell>
                <Badge className={`${MOVEMENT_TYPE_BADGE[m.type]} hover:bg-transparent`}>{MOVEMENT_TYPE_LABELS[m.type]}</Badge>
              </TableCell>
              <TableCell className={`text-center font-bold ${m.quantity_change > 0 ? "text-green-600" : "text-red-600"}`}>
                {m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change}
              </TableCell>
              <TableCell className="text-center">{m.quantity_after}</TableCell>
              <TableCell className="text-muted-foreground text-sm max-w-52 truncate">{m.note ?? "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MovementsTab({ products }: { products: InventoryRow[] }) {
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [fProduct, setFProduct] = useState<string>("all");
  const [fType, setFType] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const PAGE = 50;

  const load = useCallback(async (newOffset: number, append: boolean) => {
    setLoading(true);
    try {
      const data = await getStockMovements(appDb, {
        productId: fProduct === "all" ? null : Number(fProduct),
        type: fType === "all" ? null : (fType as MovementType),
        dateFrom: from || null,
        dateTo: to || null,
        limit: PAGE,
        offset: newOffset,
      });
      setRows((prev) => (append ? [...prev, ...data] : data));
      setOffset(newOffset);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل تحميل الحركات");
    } finally {
      setLoading(false);
    }
  }, [fProduct, fType, from, to]);

  useEffect(() => {
    const t = setTimeout(() => void load(0, false), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Select value={fProduct} onValueChange={setFProduct}>
          <SelectTrigger><SelectValue placeholder="كل المنتجات" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المنتجات</SelectItem>
            {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fType} onValueChange={setFType}>
          <SelectTrigger><SelectValue placeholder="كل الأنواع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            {ALL_MOVEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" />
      </div>
      <MovementsTable rows={rows} />
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{loading ? "جارٍ التحميل..." : `معروض: ${rows.length}`}</p>
        {rows.length > offset && (
          <Button variant="outline" size="sm" onClick={() => load(offset + PAGE, true)}>تحميل المزيد</Button>
        )}
      </div>
    </div>
  );
}

function MovementsByProduct({ productId, productName, onBack }: { productId: number; productName: string; onBack: () => void }) {
  const [rows, setRows] = useState<MovementRow[]>([]);
  useEffect(() => {
    getStockMovements(appDb, { productId, limit: 200 }).then(setRows).catch((e) => toast.error(String(e?.message ?? e)));
  }, [productId]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">سجل حركات: {productName}</h3>
        <Button variant="outline" size="sm" onClick={onBack}>عرض كل الحركات</Button>
      </div>
      <MovementsTable rows={rows} />
    </div>
  );
}

// ---------- Inner page (useSearchParams requires a Suspense boundary for static export) ----------

function InventoryInner() {
  const searchParams = useSearchParams();
  const restockParam = searchParams.get("restock");

  const [tab, setTab] = useState<Tab>("stock");
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [restockOpen, setRestockOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [presetProductId, setPresetProductId] = useState<number | null>(null);
  const [historyFor, setHistoryFor] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, cats] = await Promise.all([
        getInventorySummary(appDb),
        getInventoryRows(appDb, {
          search,
          categoryId: categoryId === "all" ? null : Number(categoryId),
          status: status === "all" ? null : (status as "ok" | "low" | "out"),
        }),
        categories.length ? Promise.resolve(categories) : listCategories(appDb),
      ]);
      setSummary(s);
      setRows(r);
      setCategories(cats);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر تحميل المخزون");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, categoryId, status]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  // deep link /inventory?restock=<id>
  useEffect(() => {
    if (!restockParam) return;
    const id = Number(restockParam);
    if (!Number.isInteger(id) || id <= 0) return;
    const t = setTimeout(() => {
      setPresetProductId(id);
      setRestockOpen(true);
    }, 0);
    return () => clearTimeout(t);
  }, [restockParam]);

  const openRestock = (id?: number) => { setPresetProductId(id ?? null); setRestockOpen(true); };

  const cards = summary
    ? [
        { label: "عدد المنتجات", value: String(summary.totalProducts) },
        { label: "إجمالي القطع", value: String(summary.totalUnits) },
        { label: "قيمة المخزون (شراء)", value: formatMoney(summary.stockValueAtCost) },
        { label: "قيمة المخزون (بيع)", value: formatMoney(summary.stockValueAtSale) },
        { label: "الربح المتوقع", value: formatMoney(summary.expectedProfit) },
        { label: "قاربت على النفاد", value: String(summary.lowStockCount) },
        { label: "نفدت", value: String(summary.outOfStockCount) },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title="المخزون" description="تزويد الكميات، الجرد، وسجل الحركات">
        <div className="flex gap-2">
          <Button onClick={() => openRestock()}><PackagePlus className="size-4 me-2" /> تزويد المخزون</Button>
          <Button variant="outline" onClick={() => setAdjustOpen(true)}><ClipboardList className="size-4 me-2" /> جرد / تعديل</Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-lg font-bold mt-1 truncate">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 border-b pb-px">
        <button
          onClick={() => { setTab("stock"); setHistoryFor(null); }}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg ${tab === "stock" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
        >
          المخزون الحالي
        </button>
        <button
          onClick={() => setTab("movements")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg ${tab === "movements" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
        >
          سجل الحركات
        </button>
      </div>

      {tab === "stock" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative md:col-span-2">
              <Search className="absolute inset-y-0 my-auto size-4 text-muted-foreground start-3" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو المعرف..." className="ps-9" />
            </div>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="كل الأقسام" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأقسام</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="كل الحالات" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="ok">متوفر</SelectItem>
                <SelectItem value="low">قارب على النفاد</SelectItem>
                <SelectItem value="out">نفد</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المعرف</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>القسم</TableHead>
                  <TableHead className="text-center">الكمية</TableHead>
                  <TableHead>سعر الشراء</TableHead>
                  <TableHead>قيمة المخزون</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-center">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                )}
                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12">
                      <Boxes className="size-10 mx-auto mb-3 text-muted-foreground" />
                      <p className="font-medium">لا توجد منتجات في المخزون</p>
                      <p className="text-sm text-muted-foreground mt-1">أضف منتجات من صفحة المنتجات ثم زوّد مخزونك من هنا</p>
                      <Link href="/products"><Button variant="outline" size="sm" className="mt-4">الذهاب إلى المنتجات</Button></Link>
                    </TableCell>
                  </TableRow>
                )}
                {!loading && rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">{r.id}</TableCell>
                    <TableCell className="font-medium">{r.name}<div className="text-xs text-muted-foreground">{r.sku}</div></TableCell>
                    <TableCell>{r.categoryName}</TableCell>
                    <TableCell className="text-center font-bold">{r.quantity}</TableCell>
                    <TableCell>{formatMoney(r.purchase_price)}</TableCell>
                    <TableCell>{formatMoney(r.stockValueAtCost)}</TableCell>
                    <TableCell>{statusBadge(r)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => openRestock(r.id)}>تزويد</Button>
                      <Button variant="ghost" size="sm" onClick={() => { setPresetProductId(r.id); setAdjustOpen(true); }}>جرد</Button>
                      <Button variant="ghost" size="sm" onClick={() => setHistoryFor(r.id)}>السجل</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {tab === "movements" && (
        historyFor ? (
          <MovementsByProduct productId={historyFor} productName={rows.find((r) => r.id === historyFor)?.name ?? ""} onBack={() => setHistoryFor(null)} />
        ) : (
          <MovementsTab products={rows} />
        )
      )}

      <RestockDialog open={restockOpen} onOpenChange={setRestockOpen} products={rows} presetProductId={presetProductId} onSaved={refresh} />
      <AdjustDialog open={adjustOpen} onOpenChange={setAdjustOpen} products={rows} presetProductId={presetProductId} onSaved={refresh} />
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">جارٍ التحميل...</div>}>
      <InventoryInner />
    </Suspense>
  );
}
