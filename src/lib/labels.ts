// ===== Shared Arabic labels (movement types, sale types/status, stock status) =====

import type { MovementType, SaleStatus, SaleType } from '@/types';

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  initial: 'رصيد أولي',
  restock: 'تزويد',
  sale_store: 'بيع في المحل',
  sale_outside: 'بيع خارجي',
  adjustment: 'تعديل',
  return: 'إرجاع',
  cancel_return: 'إلغاء طلب',
};

/** Tailwind classes for a colored badge per movement type. */
export const MOVEMENT_TYPE_BADGE: Record<MovementType, string> = {
  initial: 'bg-blue-100 text-blue-800 border-blue-200',
  restock: 'bg-green-100 text-green-800 border-green-200',
  sale_store: 'bg-violet-100 text-violet-800 border-violet-200',
  sale_outside: 'bg-purple-100 text-purple-800 border-purple-200',
  adjustment: 'bg-amber-100 text-amber-800 border-amber-200',
  return: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  cancel_return: 'bg-red-100 text-red-800 border-red-200',
};

export const SALE_TYPE_LABELS: Record<SaleType, string> = {
  store: 'بيع في المحل',
  outside: 'بيع خارجي',
};

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  pending: 'قيد الانتظار',
  confirmed: 'مؤكد',
  cancelled: 'ملغى',
};

/** Tailwind classes for a colored status badge (yellow / green / gray). */
export const SALE_STATUS_BADGE: Record<SaleStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
};

export const STOCK_STATUS_LABELS: Record<'ok' | 'low' | 'out', string> = {
  ok: 'متوفر',
  low: 'قارب على النفاد',
  out: 'نفد',
};

/** Quick WhatsApp message templates for distributors (editable here). */
export const WHATSAPP_MESSAGE_TEMPLATES: { key: string; label: string; message: string }[] = [
  { key: 'empty', label: 'رسالة فارغة', message: '' },
  {
    key: 'prices',
    label: 'الاطلاع على الأسعار',
    message: 'السلام عليكم، أريد الاطلاع على الأسعار الجديدة',
  },
  {
    key: 'order',
    label: 'طلب كمية جديدة',
    message: 'السلام عليكم، أريد طلب كمية جديدة من المنتجات',
  },
];
