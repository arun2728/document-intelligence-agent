import "server-only";
import { Interfaze } from "interfaze";

export const MODEL = process.env.INTERFAZE_MODEL || "interfaze-1";

/**
 * The guard verdict comes from Interfaze's text/image guardrail classifiers, not
 * from the model's reply, so the lite model is enough. Measured ~2x faster than
 * interfaze-1 with the same classifiers running.
 */
export const GUARD_MODEL = process.env.INTERFAZE_GUARD_MODEL || "interfaze-1.1-lite";

/** Full model: routes images through OCR / guardrail classifiers as needed. */
export const interfaze = new Interfaze();

/**
 * Text-only calls (classification, extraction from OCR text) already know no tool
 * is needed, so skip the mixture-of-architecture router. Measured ~2x faster
 * with identical output on the same prompt.
 */
export const interfazeDirect = new Interfaze({ bypassMoA: true });
