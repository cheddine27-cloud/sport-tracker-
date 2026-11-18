// ===== Shared Arabic labels (movement types, sale types/status, stock status, delivery) =====

import type { MovementType, SaleStatus, SaleType } from '@/types';

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  initial: 'رصيد أولي',
  restock: 'تزويد',
  sale_store: 'بيع في المحل',
  sale_outside: 'بيع خارجي',
  adjustment: 'تعديل جرد',
  return: 'إرجاع منتج',
  cancel_return: 'إلغاء طلب',
};

/** Dark modern classes for movement type badges */
export const MOVEMENT_TYPE_BADGE: Record<MovementType, string> = {
  initial: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  restock: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  sale_store: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
  sale_outside: 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  adjustment: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  return: 'bg-teal-500/15 text-teal-400 border border-teal-500/30',
  cancel_return: 'bg-red-500/15 text-red-400 border border-red-500/30',
};

export const SALE_TYPE_LABELS: Record<SaleType, string> = {
  store: 'بيع مباشر بالمحل',
  outside: 'طلب توصيل خارجي',
};

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  pending: 'قيد التجهيز / الإرسال',
  confirmed: 'تم التسليم بنجاح',
  cancelled: 'ملغي / مسترجع',
};

/** Dark modern status badges */
export const SALE_STATUS_BADGE: Record<SaleStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  confirmed: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  cancelled: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
};

export const STOCK_STATUS_LABELS: Record<'ok' | 'low' | 'out', string> = {
  ok: 'متوفر',
  low: 'قارب على النفاد',
  out: 'نفد من المخزن',
};

/** WhatsApp message generators for Customers and Delivery */
export function buildCustomerOrderWhatsApp(order: {
  id: number;
  customer_name?: string | null;
  total: number;
  itemsSummary: string;
}): string {
  return encodeURIComponent(
    `مرحباً ${order.customer_name || 'زبوننا العزيز'} 👋\n\nنود إعلامك بأن طلبك رقم #${order.id} من متجرنا الرياضي قيد التجهيز:\n📦 الطلبات: ${order.itemsSummary}\n💰 المبلغ المستحق: ${order.total.toLocaleString()} دج\n\nشكراً لثقتكم واختياركم لنا! 🏃‍♂️`
  );
}

/** Quick WhatsApp message templates for distributors & suppliers */
export const WHATSAPP_MESSAGE_TEMPLATES: { key: string; label: string; message: string }[] = [
  { key: 'empty', label: 'رسالة فارغة', message: '' },
  {
    key: 'prices',
    label: 'الاطلاع على الأسعار الجديدة',
    message: 'السلام عليكم، يرجى تزويدنا بجدول الأسعار وقائمة المنتجات المتوفرة حالياً.',
  },
  {
    key: 'order',
    label: 'طلبية سلعة وتزويد مخزون',
    message: 'السلام عليكم، نحتاج تزويد وتجهيز شحنة جديدة لمحلنا في أقرب وقت.',
  },
  {
    key: 'tracking',
    label: 'متابعة شحنة التوصيل',
    message: 'السلام عليكم، نود الاستفسار عن كود تتبع شحنة السلع المرسلة.',
  },
];
