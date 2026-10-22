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
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('213')) return digits;
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length < 8 || digits.length > 10) return null;
  return `213${digits}`;
}

/** Full wa.me URL for a phone number, or null when invalid. */
export function whatsappUrl(raw: string | null | undefined): string | null {
  const n = toWhatsAppNumber(raw);
  return n ? `https://wa.me/${n}` : null;
}
