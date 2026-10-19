export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;

export const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

/** `date_of_birth` → `Date of birth`, `line_items.0.amount` → `Amount`. */
export const fieldLabel = (path: string) => {
  const key = path.split(".").at(-1) ?? path;
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export type Tone = "good" | "warn" | "bad";

export const confidenceTone = (c: number): Tone => (c >= 0.9 ? "good" : c >= 0.75 ? "warn" : "bad");

/** Keep the last 4 characters of identifiers, hide the rest. */
export const mask = (value: string) =>
  value.length <= 4 ? "•".repeat(value.length) : `${value.slice(0, -4).replace(/[^\s]/g, "•")}${value.slice(-4)}`;
