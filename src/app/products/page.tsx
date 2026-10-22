"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Layers,
  PackageSearch,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProductFormDialog } from "@/components/products/ProductFormDialog";
import { CategoriesDialog } from "@/components/products/CategoriesDialog";
import { appDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import type { Category, Product } from "@/types";
import { getCategories } from "@/services/categories";
import {
  deleteProduct,
  getProductById,
  getProducts,
  restoreProduct,
  type ProductInput,
} from "@/services/products";

export default function ProductsPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<number | null>(null); // null = الكل
  const [showInactive, setShowInactive] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [similar, setSimilar] = useState<{
    input: ProductInput;
    product: Product;
  } | null>(null);
  const [similarResolver, setSimilarResolver] = useState<
    ((v: boolean) => void) | null
  >(null);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await getCategories(appDb));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر تحميل الأقسام");
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getProducts(appDb, {
        search: search || undefined,
        categoryId: activeTab,
        includeInactive: showInactive,
      });
      setProducts(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر تحميل المنتجات");
    } finally {
      setLoading(false);
    }
  }, [search, activeTab, showInactive]);

  useEffect(() => {
    const t1 = setTimeout(() => void loadCategories(), 0);
    const t2 = setTimeout(() => void loadProducts(), 250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [loadCategories, loadProducts]);

  const refreshAll = () => {
    void loadCategories();
    void loadProducts();
  };

  /** Similar-product confirmation: resolves true if user chose "add anyway". */
  const onSimilarFound = (
    input: ProductInput,
    existing: Product,
  ): Promise<boolean> => {
    setSimilar({ input, product: existing });
    return new Promise<boolean>((resolve) => setSimilarResolver(() => resolve));
  };

  const closeSimilar = (proceed: boolean) => {
    similarResolver?.(proceed);
    setSimilarResolver(null);
    setSimilar(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const result = await deleteProduct(appDb, deleteTarget.id);
      toast(result.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر حذف المنتج");
    }
    setDeleteTarget(null);
    void loadProducts();
  };

  const handleRestore = async (p: Product) => {
    try {
      await restoreProduct(appDb, p.id);
      toast.success(`تمت إعادة تفعيل المنتج "${p.name}"`);
      void loadProducts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذرت إعادة التفعيل");
    }
  };

  const stockBadge = (p: Product) => {
    if (p.quantity === 0) return <Badge variant="destructive">نفد</Badge>;
    if (p.quantity <= p.low_stock_threshold)
      return (
        <Badge className="bg-orange-500 text-white hover:bg-orange-500">
          قارب على النفاد
        </Badge>
      );
    return <Badge variant="secondary">متوفر</Badge>;
  };

  return (
    <>
      <PageHeader title="المنتجات" description="إدارة منتجات المحل وأقسامه">
        <Button variant="outline" onClick={() => setCatsOpen(true)}>
          <Layers className="ms-2 h-4 w-4" />
          إدارة الأقسام
        </Button>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="ms-2 h-4 w-4" />
          إضافة منتج
        </Button>
      </PageHeader>

      {/* Tabs: الكل + one per category */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant={activeTab === null ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab(null)}
        >
          الكل
        </Button>
        {categories.map((c) => (
          <Button
            key={c.id}
            variant={activeTab === c.id ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab(c.id)}
          >
            {c.name}
          </Button>
        ))}
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو المعرف أو اللون أو النوع..."
              className="ps-9"
            />
          </div>
          <Label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            إظهار المحذوفة
          </Label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="py-10 text-center text-muted-foreground">
              جارٍ التحميل...
            </p>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <PackageSearch className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">لا توجد منتجات مطابقة</p>
              <p className="text-sm text-muted-foreground">
                {search
                  ? "جرّب كلمة بحث أخرى أو غيّر القسم."
                  : "ابدأ بإضافة أول منتج للمحل عبر زر «إضافة منتج»."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المعرف</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>القسم</TableHead>
                  <TableHead>المقاس</TableHead>
                  <TableHead>اللون</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>سعر الشراء</TableHead>
                  <TableHead>سعر البيع</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-end">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow
                    key={p.id}
                    className={p.is_active === 0 ? "opacity-60" : ""}
                  >
                    <TableCell dir="ltr" className="text-start font-mono text-xs">
                      {p.sku}
                    </TableCell>
                    <TableCell className="font-medium">
                      {p.is_active === 0 && (
                        <Badge
                          variant="outline"
                          className="ms-2 border-red-300 text-red-600"
                        >
                          محذوف
                        </Badge>
                      )}
                      {p.name}
                    </TableCell>
                    <TableCell>{p.categoryName}</TableCell>
                    <TableCell>{p.size ?? "-"}</TableCell>
                    <TableCell>{p.color ?? "-"}</TableCell>
                    <TableCell>{p.material ?? "-"}</TableCell>
                    <TableCell>{formatMoney(p.purchase_price)}</TableCell>
                    <TableCell>{formatMoney(p.sale_price)}</TableCell>
                    <TableCell className="font-bold">{p.quantity}</TableCell>
                    <TableCell>{stockBadge(p)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {p.is_active === 0 ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="استعادة"
                            onClick={() => void handleRestore(p)}
                          >
                            <RotateCcw className="h-4 w-4 text-green-700" />
                          </Button>
                        ) : (
                          <>
                            <Link href={`/inventory?restock=${p.id}`}>
                              <Button size="icon" variant="ghost" title="تزويد">
                                <Truck className="h-4 w-4 text-blue-600" />
                              </Button>
                            </Link>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="تعديل"
                              onClick={async () => {
                                const full = await getProductById(appDb, p.id, true);
                                setEditing(full ?? p);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="حذف"
                              className="text-red-600"
                              onClick={() => setDeleteTarget(p)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        categories={categories}
        product={editing}
        onSaved={() => void loadProducts()}
        onSimilarFound={onSimilarFound}
      />

      <CategoriesDialog
        open={catsOpen}
        onOpenChange={setCatsOpen}
        onChanged={refreshAll}
      />

      {/* Delete confirmation (explains hard vs soft delete) */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تأكيد الحذف</DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <p className="text-sm leading-relaxed">
              هل تريد حذف المنتج{" "}
              <span className="font-bold">«{deleteTarget.name}»</span>؟
              <br />
              <span className="text-muted-foreground">
                إذا كان المنتج يملك سجل حركات مخزون أو مبيعات فسيُخفى فقط (حذف
                ناعم) حفاظا على السجلات، وإلا سيُحذف نهائيا مع رصيده الأولي.
              </span>
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              إلغاء
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Similar product confirmation */}
      <Dialog open={!!similar} onOpenChange={(o) => !o && closeSimilar(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>منتج مشابه موجود</DialogTitle>
          </DialogHeader>
          {similar && (
            <p className="text-sm leading-relaxed">
              هذا المنتج موجود مسبقا (الكمية الحالية: {similar.product.quantity}).
              هل تريد زيادة كميته بدل إضافته من جديد؟
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                if (similar) {
                  const id = similar.product.id;
                  closeSimilar(false);
                  toast.info(
                    "صفحة المخزون (التزويد) ستُنجز في المرحلة القادمة — سيتم فتحها الآن",
                  );
                  router.push(`/inventory?restock=${id}`);
                } else {
                  closeSimilar(false);
                }
              }}
            >
              زيادة الكمية
            </Button>
            <Button onClick={() => closeSimilar(true)}>
              إضافة كمنتج جديد على أي حال
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
