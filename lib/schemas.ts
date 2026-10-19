import { z } from "zod";
import type { DocumentType } from "./document-types";

// Every field is nullable rather than optional: structured output stays strict
// (all keys present) and "not on the document" is an explicit null, not a guess.
const text = (description: string) => z.string().nullable().describe(description);
const date = (description: string) =>
  z.string().nullable().describe(`${description}. ISO 8601 (YYYY-MM-DD).`);
const money = (description: string) =>
  z.number().nullable().describe(`${description}. Plain number, no currency symbol.`);

export const passportSchema = z.object({
  surname: text("Surname / last name"),
  given_names: text("Given names"),
  passport_number: text("Passport number"),
  nationality: text("Nationality as printed"),
  issuing_country: text("Issuing country or ISO 3166 alpha-3 code"),
  sex: text("Sex as printed (M/F/X)"),
  date_of_birth: date("Date of birth"),
  place_of_birth: text("Place of birth"),
  issue_date: date("Date of issue"),
  expiry_date: date("Date of expiry"),
  mrz: text("Machine-readable zone lines joined with a newline, verbatim"),
});

export const driversLicenseSchema = z.object({
  first_name: text("First and middle names"),
  last_name: text("Last name / family name"),
  date_of_birth: date("Date of birth"),
  license_number: text("Driver's license number"),
  license_class: text("License class"),
  issuing_region: text("Issuing state, province, or country"),
  address: text("Full residential address on one line"),
  sex: text("Sex as printed"),
  issue_date: date("Date of issue"),
  expiry_date: date("Date of expiry"),
});

export const nationalIdSchema = z.object({
  full_name: text("Full name of the holder"),
  id_number: text("Identity document number"),
  nationality: text("Nationality"),
  date_of_birth: date("Date of birth"),
  sex: text("Sex as printed"),
  address: text("Address on one line"),
  issue_date: date("Date of issue"),
  expiry_date: date("Date of expiry"),
});

export const invoiceSchema = z.object({
  vendor_name: text("Company issuing the invoice"),
  vendor_address: text("Vendor address on one line"),
  invoice_number: text("Invoice number"),
  invoice_date: date("Invoice date"),
  due_date: date("Payment due date"),
  bill_to: text("Customer being billed"),
  currency: text("ISO 4217 currency code"),
  line_items: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().nullable(),
      unit_price: z.number().nullable(),
      amount: z.number().describe("Line total"),
    }),
  ),
  subtotal: money("Subtotal before tax"),
  tax: money("Total tax"),
  total: money("Amount due"),
});

export const receiptSchema = z.object({
  merchant_name: text("Merchant / store name"),
  merchant_address: text("Merchant address on one line"),
  date: date("Transaction date"),
  time: text("Transaction time, 24h HH:MM"),
  currency: text("ISO 4217 currency code"),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().nullable(),
      price: z.number().describe("Line total"),
    }),
  ),
  subtotal: money("Subtotal before tax"),
  tax: money("Total tax"),
  tip: money("Tip"),
  total: money("Total paid"),
  payment_method: text("Payment method, e.g. VISA •••• 1234 or cash"),
});

export const otherSchema = z.object({
  title: text("Document title or heading"),
  summary: z.string().describe("One-sentence description of the document"),
  fields: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .describe("Every labelled key/value pair on the document"),
});

export const EXTRACTION_SCHEMAS = {
  passport: passportSchema,
  drivers_license: driversLicenseSchema,
  national_id: nationalIdSchema,
  invoice: invoiceSchema,
  receipt: receiptSchema,
  other: otherSchema,
} satisfies Record<DocumentType, z.ZodObject>;

export type ExtractionFor<T extends DocumentType> = z.infer<(typeof EXTRACTION_SCHEMAS)[T]>;

/** Top-level fields that identify a person; masked in the UI and flagged in checks. */
export const PII_FIELDS: Record<DocumentType, readonly string[]> = {
  passport: ["surname", "given_names", "passport_number", "date_of_birth", "place_of_birth", "mrz"],
  drivers_license: ["first_name", "last_name", "date_of_birth", "license_number", "address"],
  national_id: ["full_name", "id_number", "date_of_birth", "address"],
  invoice: ["bill_to"],
  receipt: ["payment_method"],
  other: [],
};
