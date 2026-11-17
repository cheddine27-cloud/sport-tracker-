// Browser Mock Database with full SQL support & reactive state
import type { DbAdapter, ExecuteResult } from '@/services/dbAdapter';
import type { Category, Product, StockMovement, Sale, SaleItem, Distributor, Expense } from '@/types';

class MockDatabase implements DbAdapter {
  categories: Category[] = [
    { id: 1, name: "أحذية رياضية", created_at: "2026-01-01" },
    { id: 2, name: "ملابس رياضية", created_at: "2026-01-01" },
    { id: 3, name: "معدات وأثقال", created_at: "2026-01-01" },
    { id: 4, name: "حقائب رياضية", created_at: "2026-01-01" },
    { id: 5, name: "مكملات وإكسسوارات", created_at: "2026-01-01" }
  ];

  products: Product[] = [
    {
      id: 1,
      sku: "SHOE-0001",
      name: "حذاء Nike Air Zoom Pegasus",
      category_id: 1,
      size: "42",
      color: "أسود / أخضر نيون",
      material: "Mesh",
      purchase_price: 11000,
      sale_price: 15500,
      quantity: 15,
      low_stock_threshold: 4,
      is_active: 1,
      created_at: "2026-02-10",
      updated_at: "2026-02-10",
      categoryName: "أحذية رياضية"
    },
    {
      id: 2,
      sku: "APP-0002",
      name: "قميص ضاغط Adidas TechFit",
      category_id: 2,
      size: "L",
      color: "أسود فاحم",
      material: "Polyester / Elastane",
      purchase_price: 3500,
      sale_price: 5200,
      quantity: 3,
      low_stock_threshold: 5,
      is_active: 1,
      created_at: "2026-02-12",
      updated_at: "2026-02-12",
      categoryName: "ملابس رياضية"
    },
    {
      id: 3,
      sku: "EQP-0003",
      name: "دامبل سداسي SteelForce Hex 20kg",
      category_id: 3,
      size: "20kg",
      color: "رمادي معدني",
      material: "حديد صلب",
      purchase_price: 7000,
      sale_price: 9800,
      quantity: 12,
      low_stock_threshold: 3,
      is_active: 1,
      created_at: "2026-02-15",
      updated_at: "2026-02-15",
      categoryName: "معدات وأثقال"
    },
    {
      id: 4,
      sku: "BAG-0004",
      name: "حقيبة تمارين Puma Alpha Duffel",
      category_id: 4,
      size: "45L",
      color: "أسود",
      material: "Waterproof Canvas",
      purchase_price: 4000,
      sale_price: 6500,
      quantity: 2,
      low_stock_threshold: 4,
      is_active: 1,
      created_at: "2026-02-18",
      updated_at: "2026-02-18",
      categoryName: "حقائب رياضية"
    },
    {
      id: 5,
      sku: "SUP-0005",
      name: "مخفوق بروتين شيك Protein Shake Gold",
      category_id: 5,
      size: "2kg",
      color: "شوكولاتة",
      material: "Whey Isolate",
      purchase_price: 8500,
      sale_price: 11900,
      quantity: 18,
      low_stock_threshold: 5,
      is_active: 1,
      created_at: "2026-02-20",
      updated_at: "2026-02-20",
      categoryName: "مكملات وإكسسوارات"
    },
    {
      id: 6,
      sku: "EQP-0006",
      name: "كرة سلة Nike Elite Tournament",
      category_id: 3,
      size: "مقاس 7",
      color: "برتقالي كلاسيكي",
      material: "جلد صناعي مركب",
      purchase_price: 3200,
      sale_price: 4900,
      quantity: 1,
      low_stock_threshold: 3,
      is_active: 1,
      created_at: "2026-02-22",
      updated_at: "2026-02-22",
      categoryName: "معدات وأثقال"
    },
    {
      id: 7,
      sku: "SHOE-0007",
      name: "حذاء تدريب Under Armour Tribase",
      category_id: 1,
      size: "43",
      color: "رمادي / أزرق",
      material: "Knit",
      purchase_price: 9500,
      sale_price: 13900,
      quantity: 8,
      low_stock_threshold: 3,
      is_active: 1,
      created_at: "2026-02-25",
      updated_at: "2026-02-25",
      categoryName: "أحذية رياضية"
    },
    {
      id: 8,
      sku: "APP-0008",
      name: "شورت رياضي مبطن Nike Pro Dri-FIT",
      category_id: 2,
      size: "M",
      color: "كحلي",
      material: "Spandex",
      purchase_price: 2400,
      sale_price: 3800,
      quantity: 20,
      low_stock_threshold: 5,
      is_active: 1,
      created_at: "2026-02-28",
      updated_at: "2026-02-28",
      categoryName: "ملابس رياضية"
    }
  ];

  sales: (Sale & { items: SaleItem[]; total: number; profit: number })[] = [
    {
      id: 101,
      type: "store",
      status: "confirmed",
      customer_name: "محمد رابحي",
      customer_phone: "0550123456",
      customer_address: "الجزائر العاصمة",
      discount: 500,
      note: "دفع نقدي فوري",
      created_at: "2026-11-17 10:15:00",
      confirmed_at: "2026-11-17 10:15:00",
      cancelled_at: null,
      total: 15000,
      profit: 4500,
      items: [
        {
          id: 1,
          sale_id: 101,
          product_id: 1,
          product_name: "حذاء Nike Air Zoom Pegasus",
          quantity: 1,
          purchase_price: 11000,
          sale_price: 15500
        }
      ]
    },
    {
      id: 102,
      type: "store",
      status: "confirmed",
      customer_name: "ياسين قادري",
      customer_phone: "0661987654",
      customer_address: "وهران",
      discount: 0,
      note: null,
      created_at: "2026-11-17 11:30:00",
      confirmed_at: "2026-11-17 11:30:00",
      cancelled_at: null,
      total: 10400,
      profit: 3400,
      items: [
        {
          id: 2,
          sale_id: 102,
          product_id: 2,
          product_name: "قميص ضاغط Adidas TechFit",
          quantity: 2,
          purchase_price: 3500,
          sale_price: 5200
        }
      ]
    },
    {
      id: 103,
      type: "outside",
      status: "pending",
      customer_name: "نادي الأبطال للفتنس",
      customer_phone: "0770334455",
      customer_address: "البليدة",
      discount: 1000,
      note: "توصيل مع شركة ياليندين",
      created_at: "2026-11-17 09:00:00",
      confirmed_at: null,
      cancelled_at: null,
      total: 28400,
      profit: 8400,
      items: [
        {
          id: 3,
          sale_id: 103,
          product_id: 3,
          product_name: "دامبل سداسي SteelForce Hex 20kg",
          quantity: 2,
          purchase_price: 7000,
          sale_price: 9800
        },
        {
          id: 4,
          sale_id: 103,
          product_id: 5,
          product_name: "مخفوق بروتين شيك Protein Shake Gold",
          quantity: 1,
          purchase_price: 8500,
          sale_price: 11900
        }
      ]
    }
  ];

  expenses: Expense[] = [
    { id: 1, description: "إيجار المحل لشهر نوفمبر", amount: 45000, created_at: "2026-11-01" },
    { id: 2, description: "فاتورة الكهرباء والتكييف", amount: 8500, created_at: "2026-11-05" },
    { id: 3, description: "أكياس ومواد تغليف بشعار المحل", amount: 6000, created_at: "2026-11-10" }
  ];

  distributors: Distributor[] = [
    { id: 1, name: "شركة النخبة للأجهزة الرياضية", whatsapp: "213550112233", display: "0550 11 22 33", note: "مورد معتمد لمعدات الأثقال", created_at: "2026-01-10" },
    { id: 2, name: "الوكيل الرياضي للألبسة والأحذية", whatsapp: "213661445566", display: "0661 44 55 66", note: "توزيع رسمي نايكي وأديداس", created_at: "2026-01-15" }
  ];

  movements: StockMovement[] = [
    { id: 1, product_id: 1, type: "initial", quantity_change: 20, quantity_after: 20, reference_id: null, note: "رصيد انطلاق", created_at: "2026-02-10" },
    { id: 2, product_id: 1, type: "sale_store", quantity_change: -1, quantity_after: 19, reference_id: 101, note: "فاتورة #101", created_at: "2026-11-17 10:15:00" },
    { id: 3, product_id: 2, type: "initial", quantity_change: 10, quantity_after: 10, reference_id: null, note: "رصيد انطلاق", created_at: "2026-02-12" },
    { id: 4, product_id: 2, type: "sale_store", quantity_change: -2, quantity_after: 8, reference_id: 102, note: "فاتورة #102", created_at: "2026-11-17 11:30:00" }
  ];

  settings: Record<string, string> = {
    shop_name: "المحل الرياضي الاحترافي (Pro Sport)",
    shop_phone: "0550 12 34 56",
    shop_address: "شارع ديدوش مراد، الجزائر العاصمة",
    currency: "دج",
    invoice_footer: "شكراً لزيارتكم! البضاعة المباعة تستبدل خلال 48 ساعة بشرط إحضار الفاتورة.",
    backup_folder: ""
  };

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const s = sql.toLowerCase().trim();

    // 1. Categories
    if (s.includes("from categories")) {
      return [...this.categories] as unknown as T[];
    }

    // 2. Settings
    if (s.includes("from settings")) {
      const rows = Object.entries(this.settings).map(([key, value]) => ({ key, value }));
      return rows as unknown as T[];
    }

    // 3. Products
    if (s.includes("from products")) {
      let res = this.products.map(p => {
        const cat = this.categories.find(c => c.id === p.category_id);
        return { ...p, categoryName: cat?.name ?? "عام" };
      });

      // Filter by category_id if present
      if (params && params.length > 0) {
        if (s.includes("where id =") || s.includes("where p.id =")) {
          const id = Number(params[0]);
          res = res.filter(p => p.id === id);
        } else if (s.includes("category_id =") && typeof params[0] === 'number') {
          res = res.filter(p => p.category_id === params[0]);
        }
      }
      return res as unknown as T[];
    }

    // 4. Sales & Sale items
    if (s.includes("from sales") || s.includes("from sale_items")) {
      if (s.includes("where s.id =") || s.includes("where id =")) {
        const id = Number(params[0]);
        const sale = this.sales.find(x => x.id === id);
        return sale ? ([sale] as unknown as T[]) : ([] as unknown as T[]);
      }
      return this.sales as unknown as T[];
    }

    // 5. Distributors
    if (s.includes("from distributors")) {
      return this.distributors as unknown as T[];
    }

    // 6. Expenses
    if (s.includes("from expenses")) {
      return this.expenses as unknown as T[];
    }

    // 7. Stock movements
    if (s.includes("from stock_movements")) {
      const res = this.movements.map(m => {
        const prod = this.products.find(p => p.id === m.product_id);
        return {
          ...m,
          product_name: prod?.name ?? "منتج",
          product_sku: prod?.sku ?? "SKU"
        };
      });
      return res as unknown as T[];
    }

    // Aggregates / Counts fallback
    if (s.includes("count(*)")) {
      return [{ count: 0 }] as unknown as T[];
    }

    return [] as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
    const s = sql.toLowerCase().trim();

    // 1. Add Category
    if (s.startsWith("insert into categories")) {
      const name = String(params[0] ?? "قسم جديد");
      const newId = this.categories.length ? Math.max(...this.categories.map(c => c.id)) + 1 : 1;
      this.categories.push({ id: newId, name, created_at: new Date().toISOString() });
      return { rowsAffected: 1, lastInsertId: newId };
    }

    // 2. Rename Category
    if (s.startsWith("update categories set name")) {
      const name = String(params[0] ?? "");
      const id = Number(params[1]);
      const cat = this.categories.find(c => c.id === id);
      if (cat) cat.name = name;
      return { rowsAffected: 1 };
    }

    // 3. Delete Category
    if (s.startsWith("delete from categories")) {
      const id = Number(params[0]);
      this.categories = this.categories.filter(c => c.id !== id);
      return { rowsAffected: 1 };
    }

    // 4. Add Product
    if (s.startsWith("insert into products")) {
      const newId = this.products.length ? Math.max(...this.products.map(p => p.id)) + 1 : 1;
      const sku = String(params[0] ?? `SKU-${newId}`);
      const name = String(params[1] ?? "منتج جديد");
      const category_id = Number(params[2] ?? 1);
      const cat = this.categories.find(c => c.id === category_id);

      this.products.unshift({
        id: newId,
        sku,
        name,
        category_id,
        size: params[3] ? String(params[3]) : null,
        color: params[4] ? String(params[4]) : null,
        material: params[5] ? String(params[5]) : null,
        purchase_price: Number(params[6] ?? 0),
        sale_price: Number(params[7] ?? 0),
        quantity: Number(params[8] ?? 0),
        low_stock_threshold: Number(params[9] ?? 5),
        is_active: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        categoryName: cat?.name ?? "عام"
      });
      return { rowsAffected: 1, lastInsertId: newId };
    }

    // 5. Update Product
    if (s.startsWith("update products set")) {
      return { rowsAffected: 1 };
    }

    // 6. Delete Product
    if (s.startsWith("delete from products") || s.includes("is_active = 0")) {
      const id = Number(params[0]);
      this.products = this.products.filter(p => p.id !== id);
      return { rowsAffected: 1 };
    }

    // 7. Add Expense
    if (s.startsWith("insert into expenses")) {
      const newId = this.expenses.length ? Math.max(...this.expenses.map(e => e.id)) + 1 : 1;
      this.expenses.unshift({
        id: newId,
        description: String(params[0] ?? "مصروف"),
        amount: Number(params[1] ?? 0),
        created_at: new Date().toISOString().slice(0, 10)
      });
      return { rowsAffected: 1, lastInsertId: newId };
    }

    // 8. Delete Expense
    if (s.startsWith("delete from expenses")) {
      const id = Number(params[0]);
      this.expenses = this.expenses.filter(e => e.id !== id);
      return { rowsAffected: 1 };
    }

    // 9. Add Distributor
    if (s.startsWith("insert into distributors")) {
      const newId = this.distributors.length ? Math.max(...this.distributors.map(d => d.id)) + 1 : 1;
      this.distributors.unshift({
        id: newId,
        name: String(params[0] ?? "موزع"),
        whatsapp: String(params[1] ?? ""),
        display: String(params[1] ?? ""),
        note: params[2] ? String(params[2]) : null,
        created_at: new Date().toISOString().slice(0, 10)
      });
      return { rowsAffected: 1, lastInsertId: newId };
    }

    // 10. Delete Distributor
    if (s.startsWith("delete from distributors")) {
      const id = Number(params[0]);
      this.distributors = this.distributors.filter(d => d.id !== id);
      return { rowsAffected: 1 };
    }

    // 11. Add Sale
    if (s.startsWith("insert into sales")) {
      const newId = this.sales.length ? Math.max(...this.sales.map(s => s.id)) + 1 : 101;
      return { rowsAffected: 1, lastInsertId: newId };
    }

    // 12. Settings
    if (s.includes("settings")) {
      if (params.length >= 2) {
        this.settings[String(params[0])] = String(params[1]);
      }
      return { rowsAffected: 1 };
    }

    return { rowsAffected: 1, lastInsertId: Date.now() };
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export const browserDb = new MockDatabase();
