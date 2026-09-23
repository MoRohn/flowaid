/** Deterministic PII detection: patterns plus checksums (Luhn for cards, mod-97 for IBANs) to keep false positives down. */

export type PiiKind = "email" | "phone" | "credit_card" | "ssn" | "ip_address" | "iban" | "api_key";
export const PII_KINDS: readonly PiiKind[] = [
  "email",
  "phone",
  "credit_card",
  "ssn",
  "ip_address",
  "iban",
  "api_key",
];

export interface PiiFinding {
  kind: PiiKind;
  start: number;
  end: number;
  /** The match with all but the last four characters masked. */
  preview: string;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

const PATTERNS: Record<PiiKind, { re: RegExp; check?: (m: string) => boolean }> = {
  email: { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  credit_card: { re: /\b(?:\d[ -]?){12,18}\d\b/g, check: (m) => luhn(m.replace(/\D/g, "")) },
  ssn: { re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  iban: {
    re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g,
    check: ibanValid,
  },
  ip_address: {
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
  },
  phone: {
    re: /(?<![\w.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d{2,4}[ .-]\d{3,4}[ .-]?\d{3,4}(?![\w.])/g,
    check: (m) => m.replace(/\D/g, "").length >= 9,
  },
  api_key: {
    re: /\b(?:sk|pk|rk|fa|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{16,}\b|\bAKIA[0-9A-Z]{16}\b/g,
  },
};

const mask = (m: string) =>
  m.length <= 4 ? "*".repeat(m.length) : "*".repeat(m.length - 4) + m.slice(-4);

/** Finds PII of the given kinds; overlapping matches keep the earliest, longest one. */
export function detectPii(text: string, kinds: readonly PiiKind[] = PII_KINDS): PiiFinding[] {
  const found: PiiFinding[] = [];
  // Card/IBAN/SSN before phone so digit runs are classified by their checksum first.
  const order: PiiKind[] = [
    "email",
    "api_key",
    "iban",
    "credit_card",
    "ssn",
    "ip_address",
    "phone",
  ];
  for (const kind of order.filter((k) => kinds.includes(k))) {
    const { re, check } = PATTERNS[kind];
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (check && !check(m[0])) continue;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      found.push({ kind, start, end, preview: mask(m[0]) });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Replaces each finding with `[KIND]` (or a fixed mask). */
export function redactPii(
  text: string,
  findings: readonly PiiFinding[],
  style: "label" | "mask",
): string {
  let out = "";
  let at = 0;
  for (const f of findings) {
    out +=
      text.slice(at, f.start) +
      (style === "label" ? `[${f.kind.toUpperCase()}]` : "*".repeat(f.end - f.start));
    at = f.end;
  }
  return out + text.slice(at);
}
