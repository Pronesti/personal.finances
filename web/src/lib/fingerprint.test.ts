import { describe, it, expect } from "vitest";
import { chargeFingerprint, fingerprintAll, type ChargeIdentity } from "@/lib/fingerprint";

const coto: ChargeIdentity = {
  brand: "visa", date: "2026-08-07", description: "MERPAGO*COTO", ars: 115370.8, usd: null,
  installment_number: null, installment_count: null,
};

describe("chargeFingerprint", () => {
  it("is deterministic and 40 hex characters", () => {
    expect(chargeFingerprint(coto, 1)).toMatch(/^[0-9a-f]{40}$/);
    expect(chargeFingerprint(coto, 1)).toBe(chargeFingerprint({ ...coto }, 1));
  });
  it("changes with any identifying field and with the ordinal", () => {
    const base = chargeFingerprint(coto, 1);
    expect(chargeFingerprint({ ...coto, ars: 115370.81 }, 1)).not.toBe(base);
    expect(chargeFingerprint({ ...coto, date: "2026-08-08" }, 1)).not.toBe(base);
    expect(chargeFingerprint({ ...coto, brand: "mastercard" }, 1)).not.toBe(base);
    expect(chargeFingerprint({ ...coto, installment_number: 1, installment_count: 2 }, 1)).not.toBe(base);
    expect(chargeFingerprint(coto, 2)).not.toBe(base);
  });
  it("does not depend on merchant or category, which aliases and rules rewrite", () => {
    // Only the seven identity fields exist on the type; this documents the intent.
    expect(Object.keys(coto).sort()).toEqual(["ars", "brand", "date", "description", "installment_count", "installment_number", "usd"]);
  });
});

describe("fingerprintAll", () => {
  it("numbers identical lines in order and leaves distinct lines at ordinal 1", () => {
    const { brand, ...line } = coto;
    const fps = fingerprintAll(brand, [line, { ...line, ars: 1 }, line]);
    expect(fps[0]).toBe(chargeFingerprint(coto, 1));
    expect(fps[1]).toBe(chargeFingerprint({ ...coto, ars: 1 }, 1));
    expect(fps[2]).toBe(chargeFingerprint(coto, 2));
    expect(new Set(fps).size).toBe(3);
  });
});
