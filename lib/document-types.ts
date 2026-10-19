export const DOCUMENT_TYPES = [
  "passport",
  "drivers_license",
  "national_id",
  "invoice",
  "receipt",
  "other",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

interface DocumentTypeInfo {
  label: string;
  /** Used verbatim as the Lev `criteria` text and in the fallback classifier prompt. */
  description: string;
  /** Identity documents get KYC checks (expiry, age); financial ones get arithmetic checks. */
  family: "identity" | "financial" | "other";
}

export const DOCUMENT_TYPE_INFO: Record<DocumentType, DocumentTypeInfo> = {
  passport: {
    label: "Passport",
    description: "international travel document with a machine-readable zone (MRZ)",
    family: "identity",
  },
  drivers_license: {
    label: "Driver's license",
    description: "government-issued driving permit with license number and class",
    family: "identity",
  },
  national_id: {
    label: "National ID",
    description: "government-issued identity card that is not a driving permit or passport",
    family: "identity",
  },
  invoice: {
    label: "Invoice",
    description: "commercial billing document requesting payment, with invoice number and due date",
    family: "financial",
  },
  receipt: {
    label: "Receipt",
    description: "proof of purchase from a merchant or point of sale",
    family: "financial",
  },
  other: {
    label: "Other",
    description: "any other document",
    family: "other",
  },
};

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value);
}
