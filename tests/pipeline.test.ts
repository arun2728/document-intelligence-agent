import { describe, expect, it } from "vitest";
import { luhn, runChecks } from "@/lib/checks";
import { candidates, flattenFields, groundFields, groundValue } from "@/lib/grounding";
import { parseGuardVerdict } from "@/lib/guard";
import { parseOcrResult } from "@/lib/ocr";
// Real `ocr` precontext from Interfaze for public/samples/drivers-license.jpg.
import rawOcr from "./fixtures/ocr-drivers-license.json";

const ocr = parseOcrResult(rawOcr);

// What /api/extract returned for the same document.
const license = {
  first_name: "IVÁN ICHET",
  last_name: "MUÑOZ ESTRADA",
  date_of_birth: "1987-09-12",
  license_number: "Y4067081",
  license_class: "C",
  issuing_region: "California",
  address: "14223 BELGATE ST BALDWIN PARK CA 91706",
  sex: "M",
  issue_date: null,
  expiry_date: "2027-09-12",
};

describe("parseOcrResult", () => {
  it("flattens sections into lines with quads and confidences", () => {
    expect(ocr.width).toBe(698);
    expect(ocr.height).toBe(525);
    expect(ocr.lines[0].text).toBe("California USA DRIVER LICENSE");
    expect(ocr.lines[0].quad[0]).toEqual({ x: 63, y: 89 });
    expect(ocr.lines[0].words[0]).toMatchObject({ id: "s0l0w0", text: "California", confidence: 0.99 });
    expect(ocr.text).toContain("BALDWIN PARK");
  });

  it("falls back to word confidences and corner extents when fields are missing", () => {
    const quad = { top_left: { x: 0, y: 0 }, top_right: { x: 40, y: 0 }, bottom_right: { x: 40, y: 10 }, bottom_left: { x: 0, y: 10 } };
    const r = parseOcrResult({
      sections: [{ lines: [{ text: "HI", bounds: quad, words: [{ text: "HI", confidence: 0.5, bounds: quad }] }] }],
    });
    expect(r.lines[0].confidence).toBe(0.5);
    expect([r.width, r.height]).toEqual([40, 10]);
    expect(r.text).toBe("HI");
  });
});

describe("grounding", () => {
  const word = (id: string) => ocr.lines.flatMap((l) => l.words).find((w) => w.id === id)!.text;

  it("matches identifiers and reformatted dates to their source words", () => {
    expect(groundValue("Y4067081", ocr)!.wordIds.map(word)).toEqual(["Y4067081"]);
    expect(candidates("1987-09-12")).toContain("09121987");
    expect(groundValue("2027-09-12", ocr)!.wordIds.map(word)).toEqual(["09/12/2027"]);
  });

  it("matches names with diacritics and addresses spanning lines", () => {
    expect(groundValue("MUNOZ ESTRADA", ocr)!.wordIds.map(word)).toEqual(["MUÑOZ", "ESTRADA"]);
    const address = groundValue(license.address, ocr)!;
    expect(address.wordIds.map(word)).toEqual(["14223", "BELGATE", "ST", "BALDWIN", "PARK", "CA", "91706"]);
    expect(address.confidence).toBeGreaterThan(0.9);
  });

  it("returns null for values not on the document", () => {
    expect(groundValue("Springfield Gardens", ocr)).toBeNull();
    expect(groundValue("1999-01-01", ocr)).toBeNull();
  });

  it("flattens nested data into dotted paths, skipping nulls", () => {
    expect(flattenFields({ a: null, b: [{ c: 1 }], d: "x" })).toEqual([
      { path: "b.0.c", value: 1 },
      { path: "d", value: "x" },
    ]);
  });
});

describe("runChecks", () => {
  const groundings = groundFields(license, ocr);
  const byId = (checks: ReturnType<typeof runChecks>) => Object.fromEntries(checks.map((c) => [c.id, c]));

  it("passes an in-date adult license and flags PII", () => {
    const checks = byId(runChecks({ documentType: "drivers_license", data: license, ocr, groundings, now: new Date("2026-10-19") }));
    expect(checks.expiry.level).toBe("pass");
    expect(checks.age).toMatchObject({ level: "pass", title: "Holder is an adult (39)" });
    expect(checks["pii-fields"].level).toBe("info");
    expect(checks["id-number"]).toBeUndefined();
  });

  it("fails an expired document", () => {
    const checks = byId(runChecks({ documentType: "drivers_license", data: license, ocr, groundings, now: new Date("2028-01-01") }));
    expect(checks.expiry.level).toBe("fail");
  });

  it("checks receipt arithmetic", () => {
    const receipt = { items: [{ name: "A", quantity: 1, price: 2.5 }, { name: "B", quantity: 1, price: 7.5 }], subtotal: 10, tax: 0.8, tip: null, total: 10.8 };
    const ok = byId(runChecks({ documentType: "receipt", data: receipt, ocr, groundings: {} }));
    expect(ok["items-sum"].level).toBe("pass");
    expect(ok["total-sum"].level).toBe("pass");
    const bad = byId(runChecks({ documentType: "receipt", data: { ...receipt, total: 12 }, ocr, groundings: {} }));
    expect(bad["total-sum"].level).toBe("warn");
  });

  it("validates card numbers with Luhn", () => {
    expect(luhn("4242424242424242")).toBe(true);
    expect(luhn("4242424242424241")).toBe(false);
  });
});

describe("parseGuardVerdict", () => {
  it("reads safe responses and image scores", () => {
    const v = parseGuardVerdict("OK", [
      { name: "image_guardrail_classifier", result: { nsfw: false, nsfw_score: 0.002, nudity_score: 0.001, gore_score: 0.0007 } },
    ]);
    expect(v).toEqual({ safe: true, flagged: [], scores: { nsfw: 0.002, nudity: 0.001, gore: 0.0007 } });
  });

  it("reads flagged categories", () => {
    const v = parseGuardVerdict("unsafe S12_IMAGE, S15_IMAGE");
    expect(v.safe).toBe(false);
    expect(v.flagged.map((f) => f.code)).toEqual(["S12_IMAGE", "S15_IMAGE"]);
    expect(v.flagged[0].label).toBe("Nudity (image)");
  });
});

describe("grounding edge cases", () => {
  it("skips single-character values instead of reporting them ungrounded", () => {
    const g = groundFields({ sex: "M", license_class: "C", license_number: "Y4067081" }, ocr);
    expect(Object.keys(g)).toEqual(["license_number"]);
  });
});

describe("PII pattern detection", () => {
  const pii = (text: string) =>
    runChecks({ documentType: "other", data: {}, ocr: { ...ocr, text }, groundings: {} }).map((c) => c.id);

  it("flags grouped and contiguous card numbers", () => {
    expect(pii("VISA 4242 4242 4242 4242 APPROVED")).toContain("pii-card");
    expect(pii("CARD 4242424242424242")).toContain("pii-card");
  });

  it("ignores UPCs and long transaction codes on receipts", () => {
    // Both pass Luhn by coincidence; both came from a real Walmart receipt.
    expect(pii("GV SLIDERS 007874201625 2.98")).not.toContain("pii-card");
    expect(pii("TC# 0783 6080 4072 3416 2495 5")).not.toContain("pii-card");
  });
});
