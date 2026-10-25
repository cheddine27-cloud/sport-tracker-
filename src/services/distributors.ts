import type { DbAdapter } from '@/services/dbAdapter';
import type { Distributor } from '@/types';
import { toWhatsAppNumber } from '@/lib/phone';

/**
 * Distributor service. Stores whatsapp numbers normalized (digits only,
 * country code 213) while the original display format is kept in a suffix
 * after a single space: "213555123456 +213 555 12 34 56".
 */

export interface DistributorInput {
  name: string;
  whatsapp: string;
  note?: string | null;
}

function encodeStored(rawInput: string): string {
  const trimmed = rawInput.trim();
  const normalized = toWhatsAppNumber(trimmed);
  if (!normalized) throw new Error('رقم واتساب غير صالح. أمثلة صالحة: 0555123456 أو ‎+213 555 12 34 56.');
  return trimmed === normalized ? normalized : `${normalized} ${trimmed}`;
}

type DistributorRow = { id: number; name: string; whatsapp: string; note: string | null; created_at: string };

function decode(row: DistributorRow): Distributor {
  const idx = row.whatsapp.indexOf(' ');
  const number = idx >= 0 ? row.whatsapp.slice(0, idx) : row.whatsapp;
  const display = idx >= 0 ? row.whatsapp.slice(idx + 1) : number;
  return { ...row, whatsapp: number, display };
}

async function findConflict(
  db: DbAdapter,
  normalized: string,
  excludeId?: number,
): Promise<Distributor | null> {
  const rows = await db.query<DistributorRow>(
    'SELECT id, name, whatsapp, note, created_at FROM distributors',
  );
  for (const r of rows) {
    if (excludeId !== undefined && r.id === excludeId) continue;
    // stored value may be "213555123456" or "213555123456 <original display>"
    const storedNumber = r.whatsapp.split(' ')[0];
    if (storedNumber === normalized) return decode(r);
  }
  return null;
}

/** List distributors sorted by name; search matches name, whatsapp, note. */
export async function getDistributors(db: DbAdapter, f: { search?: string | null } = {}): Promise<Distributor[]> {
  const rows = await db.query<{ id: number; name: string; whatsapp: string; note: string | null; created_at: string }>(
    'SELECT * FROM distributors ORDER BY name',
  );
  let list = rows.map(decode);
  const s = f.search?.trim().toLowerCase();
  if (s) {
    list = list.filter(
      (d) =>
        d.name.toLowerCase().includes(s) ||
        d.whatsapp.includes(s) ||
        (d.display ?? '').toLowerCase().includes(s) ||
        (d.note ?? '').toLowerCase().includes(s),
    );
  }
  return list;
}

export async function addDistributor(db: DbAdapter, input: DistributorInput): Promise<Distributor> {
  const name = input.name.trim();
  if (!name) throw new Error('اسم الموزع مطلوب.');
  if (!input.whatsapp?.trim()) throw new Error('رقم واتساب مطلوب.');
  const stored = encodeStored(input.whatsapp);
  const normalized = stored.split(' ')[0];
  const conflict = await findConflict(db, normalized);
  if (conflict) throw new Error(`هذا الرقم مستعمل من قبل الموزع "${conflict.name}".`);
  const res = await db.execute('INSERT INTO distributors (name, whatsapp, note) VALUES (?, ?, ?)', [
    name,
    stored,
    input.note?.trim() || null,
  ]);
  return {
    id: res.lastInsertId ?? 0,
    name,
    whatsapp: normalized,
    display: input.whatsapp.trim(),
    note: input.note?.trim() || null,
    created_at: '',
  };
}

export async function updateDistributor(db: DbAdapter, id: number, input: DistributorInput): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error('اسم الموزع مطلوب.');
  if (!input.whatsapp?.trim()) throw new Error('رقم واتساب مطلوب.');
  const existing = await db.query<{ id: number }>('SELECT id FROM distributors WHERE id = ?', [id]);
  if (existing.length === 0) throw new Error('الموزع غير موجود.');
  const stored = encodeStored(input.whatsapp);
  const normalized = stored.split(' ')[0];
  const conflict = await findConflict(db, normalized, id);
  if (conflict) throw new Error(`هذا الرقم مستعمل من قبل الموزع "${conflict.name}".`);
  await db.execute('UPDATE distributors SET name = ?, whatsapp = ?, note = ? WHERE id = ?', [
    name,
    stored,
    input.note?.trim() || null,
    id,
  ]);
}

export async function deleteDistributor(db: DbAdapter, id: number): Promise<void> {
  const res = await db.execute('DELETE FROM distributors WHERE id = ?', [id]);
  if (res.rowsAffected === 0) throw new Error('الموزع غير موجود أو تم حذفه من قبل.');
}
