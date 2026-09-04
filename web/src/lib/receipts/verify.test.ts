import { describe, it, expect } from "vitest";
import { verify } from "@/lib/receipts/verify";
import { parseRows } from "@/lib/receipts/parse";
import { parseRowsText } from "@/lib/receipts/rows";
import { SMALL_RECEIPT } from "@/lib/receipts/__fixtures__/rows";

const run = (text: string) => verify(parseRows(parseRowsText(text)));

describe("verify", () => {
  it("passes the fixture with every check equal and no errors", () => {
    const r = run(SMALL_RECEIPT);
    expect(r.errors).toEqual([]);
    expect(r.checks).toEqual([
      { name: "subtotal", computed: 3559626, printed: 3559626, ok: true },
      { name: "discounts", computed: -847529, printed: -847529, ok: true },
      { name: "total", computed: 2712097, printed: 2712097, ok: true },
    ]);
    expect(r.ok).toBe(true);
  });

  it("cross-checks each printed offer against the matching discount lines", () => {
    const r = run(SMALL_RECEIPT);
    expect(r.offers).toEqual([
      { label: "1 *30% ELABORADOS", printed: 133639, computed: -133639, ok: true },
      { label: "1 *PESCADO 30%", printed: 135589, computed: -135589, ok: true },
      { label: "MERCADO PAGO 25% - V", printed: 578301, computed: -578301, ok: true },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("fails when a line total is misread, naming the check that broke", () => {
    const r = run(SMALL_RECEIPT.replace("6400,00", "6490,00"));
    expect(r.ok).toBe(false);
    expect(r.checks.map(c => [c.name, c.ok])).toEqual([["subtotal", false], ["discounts", true], ["total", false]]);
    expect(r.checks[0].computed - r.checks[0].printed!).toBe(9000);
  });

  it("fails when a discount is dropped", () => {
    const r = run(SMALL_RECEIPT.replace("MERCADO PAGO 25% - V [M]\t-793,00\n", ""));
    expect(r.checks.find(c => c.name === "discounts")?.ok).toBe(false);
  });

  it("errors on a missing ticket number, date, items or line total", () => {
    expect(run("TOTAL\t1,00\n").errors).toEqual(expect.arrayContaining([
      expect.stringContaining("date"), expect.stringContaining("NRO.T."), expect.stringContaining("no items"),
    ]));
    const noTotal = run(SMALL_RECEIPT.replace("0000014718 07798140550143\t6400,00", "0000014718 07798140550143"));
    expect(noTotal.ok).toBe(false);
    expect(noTotal.errors.join(" ")).toContain("item 3");
  });

  it("errors when a printed total is missing rather than comparing against nothing", () => {
    const r = run(SMALL_RECEIPT.replace("TOTAL\t27120,97\n", ""));
    expect(r.ok).toBe(false);
    expect(r.checks.find(c => c.name === "total")).toMatchObject({ printed: null, ok: false });
  });

  it("warns, but passes, when a unit price does not multiply out to the line total", () => {
    const r = run(SMALL_RECEIPT.replace("0,172 x 25899,00", "0,172 x 25099,00"));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/item 1 .*unit price/);
  });

  it("warns, but passes, when an offer total does not match its lines", () => {
    const r = run(SMALL_RECEIPT.replace("MERCADO PAGO 25% - V\t1355,89\n\t5783,01", "MERCADO PAGO 25% - V\t1355,89\n\t5783,02"));
    expect(r.ok).toBe(true);
    expect(r.offers[2].ok).toBe(false);
    expect(r.warnings.join(" ")).toContain("MERCADO PAGO 25% - V");
  });

  it("warns when TOT.AHORRO disagrees with the discounts", () => {
    const r = run(SMALL_RECEIPT.replace("TOT.AHORRO\t8475,29", "TOT.AHORRO\t8475,20"));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("TOT.AHORRO");
  });
});
