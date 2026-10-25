// ===== Phone helpers (Algeria) =====

/**
 * Normalize an Algerian phone number to the international wa.me format.
 * "0555123456"     -> "213555123456"
 * "+213 555 12 34 56" -> "213555123456"
 * "00213555123456" -> "213555123456"
 * invalid          -> null
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^[0-9+\-\s]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');
  // Order matters: international forms first (00213..., +213...), then local 0X...
  if (digits.startsWith('00213')) digits = digits.slice(5);
  else if (digits.startsWith('213')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length < 8 || digits.length > 10) return null;
  return `213${digits}`;
}

/**
 * Full wa.me URL for a phone number, or null when invalid.
 * Optional pre-filled message is appended as ?text=<encoded>.
 * Without a message the output is identical to the previous behavior.
 */
export function whatsappUrl(raw: string | null | undefined, message?: string | null): string | null {
  const n = toWhatsAppNumber(raw);
  if (!n) return null;
  const base = `https://wa.me/${n}`;
  const msg = message?.trim();
  return msg ? `${base}?text=${encodeURIComponent(msg)}` : base;
}
