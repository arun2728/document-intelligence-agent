import { DOCUMENT_TYPE_INFO, type DocumentType } from "./document-types";
import type { Grounding } from "./grounding";
import { averageConfidence, type OcrResult } from "./ocr";
import { PII_FIELDS } from "./schemas";

export type CheckLevel = "pass" | "warn" | "fail" | "info";

export interface Check {
  id: string;
  level: CheckLevel;
  title: string;
  detail?: string;
}

interface CheckInput {
  documentType: DocumentType;
  data: Record<string, unknown>;
  ocr: OcrResult;
  groundings: Record<string, Grounding | null>;
  now?: Date;
}

const LOW_CONFIDENCE = 0.8;
const DAY = 86_400_000;

/** Deterministic post-extraction checks. The model extracts; code decides. */
export function runChecks({ documentType, data, ocr, groundings, now = new Date() }: CheckInput): Check[] {
  const checks: Check[] = [];
  const family = DOCUMENT_TYPE_INFO[documentType].family;

  if (family === "identity") checks.push(...identityChecks(documentType, data, now));
  if (documentType === "invoice") checks.push(...arithmeticChecks(data, "line_items", "amount", ["tax"]));
  if (documentType === "receipt") checks.push(...arithmeticChecks(data, "items", "price", ["tax", "tip"]));

  // Grounding: every value should be traceable to text on the page.
  const entries = Object.entries(groundings);
  const ungrounded = entries.filter(([, g]) => !g).map(([path]) => path);
  if (entries.length) {
    checks.push(
      ungrounded.length
        ? {
            id: "grounding",
            level: "warn",
            title: `${ungrounded.length} of ${entries.length} values not found verbatim in the OCR text`,
            detail: `Normalized or inferred by the model; verify manually: ${ungrounded.join(", ")}`,
          }
        : { id: "grounding", level: "pass", title: `All ${entries.length} values traced to OCR text` },
    );
  }

  // OCR quality.
  const low = ocr.lines.filter((l) => l.confidence < LOW_CONFIDENCE);
  const avg = averageConfidence(ocr);
  checks.push(
    low.length
      ? {
          id: "ocr-quality",
          level: "warn",
          title: `${low.length} OCR line${low.length === 1 ? "" : "s"} below ${LOW_CONFIDENCE * 100}% confidence`,
          detail: `Average ${(avg * 100).toFixed(1)}%. Consider a sharper scan.`,
        }
      : { id: "ocr-quality", level: "pass", title: `OCR confidence ${(avg * 100).toFixed(1)}% average` },
  );

  checks.push(...piiChecks(documentType, data, ocr.text));
  return checks;
}

function identityChecks(documentType: DocumentType, data: Record<string, unknown>, now: Date): Check[] {
  const checks: Check[] = [];
  const expiry = parseDate(data.expiry_date);
  const dob = parseDate(data.date_of_birth);

  if (!expiry) {
    checks.push({ id: "expiry", level: "warn", title: "No expiry date found" });
  } else if (expiry.getTime() < now.getTime()) {
    checks.push({ id: "expiry", level: "fail", title: "Document is expired", detail: `Expired ${data.expiry_date}` });
  } else if (expiry.getTime() - now.getTime() < 90 * DAY) {
    checks.push({ id: "expiry", level: "warn", title: "Document expires within 90 days", detail: String(data.expiry_date) });
  } else {
    checks.push({ id: "expiry", level: "pass", title: "Document is in date", detail: `Expires ${data.expiry_date}` });
  }

  if (!dob) {
    checks.push({ id: "age", level: "warn", title: "No date of birth found" });
  } else if (dob.getTime() > now.getTime()) {
    checks.push({ id: "age", level: "fail", title: "Date of birth is in the future", detail: String(data.date_of_birth) });
  } else {
    const age = ageOn(dob, now);
    checks.push(
      age < 18
        ? { id: "age", level: "warn", title: `Holder is a minor (${age})` }
        : { id: "age", level: "pass", title: `Holder is an adult (${age})` },
    );
  }

  const idField = { passport: "passport_number", drivers_license: "license_number", national_id: "id_number" }[
    documentType as "passport" | "drivers_license" | "national_id"
  ];
  if (idField && !data[idField]) {
    checks.push({ id: "id-number", level: "fail", title: "No document number found" });
  }
  return checks;
}

function arithmeticChecks(
  data: Record<string, unknown>,
  itemsKey: string,
  amountKey: string,
  extras: string[],
): Check[] {
  const checks: Check[] = [];
  const items = Array.isArray(data[itemsKey]) ? (data[itemsKey] as Record<string, unknown>[]) : [];
  const itemSum = items.reduce((a, i) => a + (typeof i[amountKey] === "number" ? (i[amountKey] as number) : 0), 0);
  const subtotal = num(data.subtotal);
  const total = num(data.total);
  const extra = extras.reduce((a, k) => a + (num(data[k]) ?? 0), 0);

  if (total === null) {
    checks.push({ id: "total", level: "warn", title: "No total found" });
  }
  if (items.length && subtotal !== null) {
    checks.push(
      close(itemSum, subtotal)
        ? { id: "items-sum", level: "pass", title: `Line items sum to subtotal (${fmt(subtotal)})` }
        : { id: "items-sum", level: "warn", title: "Line items don't sum to subtotal", detail: `${fmt(itemSum)} vs ${fmt(subtotal)}` },
    );
  }
  if (total !== null) {
    const base = subtotal ?? (items.length ? itemSum : null);
    if (base !== null) {
      checks.push(
        close(base + extra, total)
          ? { id: "total-sum", level: "pass", title: `Subtotal + ${extras.join(" + ")} = total (${fmt(total)})` }
          : {
              id: "total-sum",
              level: "warn",
              title: `Subtotal + ${extras.join(" + ")} doesn't match total`,
              detail: `${fmt(base + extra)} vs ${fmt(total)}`,
            },
      );
    }
  }
  return checks;
}

const SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/;
// 13–19 digits, contiguous or in groups of four, not embedded in a longer digit run
// (receipts are full of UPCs and transaction codes that would otherwise match).
const CARD = /(?<![\d-]|\d )(?:\d{4}[ -]){3}\d{1,7}(?!\d| \d)|(?<!\d)\d{13,19}(?!\d)/g;

function piiChecks(documentType: DocumentType, data: Record<string, unknown>, text: string): Check[] {
  const checks: Check[] = [];
  const present = PII_FIELDS[documentType].filter((f) => data[f] !== null && data[f] !== undefined && data[f] !== "");
  if (present.length) {
    checks.push({
      id: "pii-fields",
      level: "info",
      title: `${present.length} PII field${present.length === 1 ? "" : "s"} extracted`,
      detail: `Mask before logging or storing: ${present.join(", ")}`,
    });
  }
  if (SSN.test(text)) {
    checks.push({ id: "pii-ssn", level: "warn", title: "Possible US Social Security number visible in document" });
  }
  if ((text.match(CARD) ?? []).some((m) => luhn(m.replace(/\D/g, "")))) {
    checks.push({ id: "pii-card", level: "warn", title: "Possible full payment card number visible in document" });
  }
  return checks;
}

export function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ageOn(dob: Date, now: Date): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);
const fmt = (n: number) => n.toFixed(2);
