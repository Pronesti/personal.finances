import { describe, it, expect } from "vitest";
import { parseRows, mergePages } from "@/lib/receipts/parse";
import { parseRowsText } from "@/lib/receipts/rows";
import { SMALL_RECEIPT } from "@/lib/receipts/__fixtures__/rows";

const parsed = () => parseRows(parseRowsText(SMALL_RECEIPT));

describe("parseRows: header", () => {
  it("reads date, time, identity and branch", () => {
    const { header } = parsed();
    expect(header).toMatchObject({
      date: "2026-09-04", time: "09:42:15", fiscalNumber: "2090-06514979",
      register: "0012", terminal: "3791", trx: "4969",
      branchCode: "090", branchName: "SUC 90 COTO CICSA", cuit: "30-54808315-6",
      cae: "86361418114640", caeDue: "2026-09-14",
      paymentMethod: "MERCADO PAG", paymentRef: "177204174592", paymentCents: 2712097,
    });
  });
  it("tolerates the OCR spellings of the ticket number line", () => {
    const rows = parseRowsText("04/09/2026 09:42:15 NRO.1.:2090-06514979\nNRO, TERM: 3791\n");
    expect(parseRows(rows).header).toMatchObject({ fiscalNumber: "2090-06514979", terminal: "3791" });
  });
});

describe("parseRows: items", () => {
  it("builds one item per code line, in printed order, with the page overlap removed", () => {
    const { items } = parsed();
    expect(items.map(i => i.sku)).toEqual([
      "0000038072", "0000000726", "0000014718", "0000022865", "0000255634", "0000051732",
    ]);
    expect(items.map(i => i.position)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reads a weighed item: kg, three-decimal quantity, printed unit price", () => {
    const [verduras] = parsed().items;
    expect(verduras).toMatchObject({
      descPrinted: "VERDURAS GRILLADAS COTOX KG", noPromo: false, ean: "02538072001727",
      qtyMilli: 172, unit: "kg", unitPriceCents: 2589900, lineTotalCents: 445463,
      discounts: [{ label: "1 *30% ELABORADOS", tag: "A", amountCents: -133639 }],
    });
  });

  it("attaches several discount lines to one item", () => {
    const pescado = parsed().items[1];
    expect(pescado.discounts).toEqual([
      { label: "1 *PESCADO 30%", tag: "A", amountCents: -135589 },
      { label: "MERCADO PAGO 25% - V", tag: "M", amountCents: -1 },
    ]);
  });

  it("reads a unit item with no quantity line as one unit and no unit price", () => {
    const chorizo = parsed().items[2];
    expect(chorizo).toMatchObject({ qtyMilli: 1000, unit: "un", unitPriceCents: null, lineTotalCents: 640000 });
  });

  it("keeps the '=' prefix and flags no_promo", () => {
    const huevo = parsed().items[3];
    expect(huevo).toMatchObject({ descPrinted: "=HUEVO BLANCOCJA 12 UNI", noPromo: true, discounts: [] });
  });

  it("reads a multi-unit item: units in thousandths", () => {
    const levite = parsed().items[4];
    expect(levite).toMatchObject({ qtyMilli: 4000, unit: "un", unitPriceCents: 339000, lineTotalCents: 1356000 });
    expect(levite.discounts).toEqual([{ label: "MERCADO PAGO 25% - V", tag: "M", amountCents: -339000 }]);
  });

  it("normalises an OCR '-' or '−' marker to '='", () => {
    const rows = parseRowsText("-ACEITE GIRASOL\n0000163580 07790272001005\t4406,00\n");
    expect(parseRows(rows).items[0]).toMatchObject({ descPrinted: "=ACEITE GIRASOL", noPromo: true });
  });

  it("takes a line total that landed on the description row", () => {
    const rows = parseRowsText("1,072 x 2299,00\n=BANANA CAVENDISHX KG\t2464,53\n0000000446 02500446010727\n");
    expect(parseRows(rows).items[0]).toMatchObject({ lineTotalCents: 246453, qtyMilli: 1072, unit: "kg" });
  });

  it("takes a line total that landed on its own row after the code", () => {
    const rows = parseRowsText("PISI\n0000012345 07790000000001\n\t21950,00\n1 *25% MARCAS [A]\t-5487,50\n");
    expect(parseRows(rows).items[0]).toMatchObject({ lineTotalCents: 2195000, discounts: [{ amountCents: -548750 }] });
  });

  it("accepts OCR variants of the tag", () => {
    const rows = parseRowsText("X\n0000000001 000000000001\t1,00\n1 *PESCADO 30% LA]\t-0,30\nMERCADO PAGO (M)\t-0,10\n");
    expect(parseRows(rows).items[0].discounts.map(d => d.tag)).toEqual(["A", "M"]);
  });

  it("leaves an item without a line total as null and notes it", () => {
    const r = parseRows(parseRowsText("X\n0000000001 000000000001\nSUBTOT. SIN DESCUENTOS\t0,00\n"));
    expect(r.items[0].lineTotalCents).toBeNull();
    expect(r.notes.join(" ")).toContain("line total");
  });
});

describe("parseRows: footer", () => {
  it("reads the three totals and the savings line", () => {
    const { footer } = parsed();
    expect(footer).toMatchObject({
      subtotalCents: 3559626, discountsCents: -847529, totalCents: 2712097, savingsCents: 847529,
    });
  });
  it("pairs offer labels with amounts by order, surviving the row offset", () => {
    expect(parsed().footer.offers).toEqual([
      { label: "1 *30% ELABORADOS", amountCents: 133639 },
      { label: "1 *PESCADO 30%", amountCents: 135589 },
      { label: "MERCADO PAGO 25% - V", amountCents: 578301 },
    ]);
  });
});

describe("mergePages", () => {
  const rows = (s: string) => parseRowsText(s);
  it("drops the run of items page 2 repeats from the end of page 1", () => {
    const merged = mergePages(rows(
      "## page 1\nA\n0000000001 000000000001\t1,00\nB\n0000000002 000000000002\t2,00\n" +
      "## page 2\nB\n0000000002 000000000002\t2,00\nC\n0000000003 000000000003\t3,00\n"));
    expect(merged.filter(r => /^\d{10} /.test(r.label)).map(r => r.label.slice(0, 10)))
      .toEqual(["0000000001", "0000000002", "0000000003"]);
  });
  it("keeps page 2's copy of the last duplicated item when it has the discount rows", () => {
    const merged = mergePages(rows(
      "## page 1\nA\n0000000001 000000000001\t1,00\n" +
      "## page 2\n0000000001 000000000001\t1,00\nPROMO [A]\t-0,50\nB\n0000000002 000000000002\t2,00\n"));
    expect(merged.map(r => r.label)).toEqual([
      "A", "0000000001 000000000001", "PROMO [A]", "B", "0000000002 000000000002",
    ]);
  });
  it("matches anchors on the EAN when the article code was misread", () => {
    const merged = mergePages(rows(
      "## page 1\nA\n0000000001 000000000001\t1,00\n" +
      "## page 2\n0000000007 000000000001\t1,00\nB\n0000000002 000000000002\t2,00\n"));
    expect(merged.filter(r => /^\d{10} /.test(r.label))).toHaveLength(2);
  });
  it("concatenates pages that do not overlap", () => {
    const merged = mergePages(rows("## page 1\nA\n0000000001 000000000001\t1,00\n## page 2\nTOTAL\t1,00\n"));
    expect(merged).toHaveLength(3);
  });
});
