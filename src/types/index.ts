// ===== Database entity types (mirror of the SQLite schema) =====

export type MovementType =
  | 'initial'
  | 'restock'
  | 'sale_store'
  | 'sale_outside'
  | 'adjustment'
  | 'return'
  | 'cancel_return';

export type SaleType = 'store' | 'outside';

export type SaleStatus = 'pending' | 'confirmed' | 'cancelled';

export interface Category {
  id: number;
  name: string;
  created_at: string;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  category_id: number;
  size: string | null;
  color: string | null;
  material: string | null;
  purchase_price: number; // stored in whole dinars (DA)
  sale_price: number; // stored in whole dinars (DA)
  quantity: number;
  low_stock_threshold: number;
  is_active: number; // 0 | 1
  created_at: string;
  updated_at: string;
  /** Joined label, present when fetched with a JOIN on categories */
  categoryName?: string;
}

export interface StockMovement {
  id: number;
  product_id: number;
  type: MovementType;
  quantity_change: number; // positive or negative
  quantity_after: number;
  reference_id: number | null; // sale id when relevant
  note: string | null;
  created_at: string;
}

export interface Sale {
  id: number;
  type: SaleType;
  status: SaleStatus;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  discount: number;
  note: string | null;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string; // snapshot at sale time
  quantity: number;
  purchase_price: number; // snapshot at sale time
  sale_price: number; // snapshot at sale time
}

export interface Distributor {
  id: number;
  name: string;
  /** normalized number, digits only with country code (213...) */
  whatsapp: string;
  /** original display format as entered by the user */
  display?: string;
  note: string | null;
  created_at: string;
}

export interface Expense {
  id: number;
  description: string;
  amount: number;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string | null;
}
