// Request/response contracts shared by the route handlers and the client.
import type { DocumentType } from "./document-types";
import type { GuardVerdict } from "./guard";
import type { OcrResult } from "./ocr";

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface GuardResponse extends GuardVerdict {
  latencyMs: number;
}

export interface OcrResponse {
  ocr: OcrResult;
  latencyMs: number;
  usage: Usage | null;
}

export interface ClassifyRequest {
  text: string;
}

export interface ClassifyResponse {
  engine: "lev" | "interfaze";
  documentType: DocumentType;
  probabilities: Record<DocumentType, number>;
  /** True only for Lev; LLM self-reported probabilities are not calibrated. */
  calibrated: boolean;
  /** Extra yes/no probabilities answered in the same Lev forward pass. */
  signals: Record<string, number>;
  outputTokens: number | null;
  latencyMs: number;
  /** Why the fallback was used, when it was. */
  note?: string;
}

export interface ExtractRequest {
  text: string;
  documentType: DocumentType;
}

export interface ExtractResponse {
  documentType: DocumentType;
  data: Record<string, unknown>;
  /** Zod validation issues, if the model's JSON didn't match the schema. */
  issues: string[];
  latencyMs: number;
  usage: Usage | null;
}

export interface ApiErrorBody {
  error: string;
}
