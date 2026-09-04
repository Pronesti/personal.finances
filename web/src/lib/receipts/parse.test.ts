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

  it("splits a code+ean+amount row when Vision misread the decimal comma as a period", () => {
    const rows = parseRowsText("JAMON COCIDO\n0000563919 07798013103377 7699.00\n1 *40% MARCAS [A]\t-3079,60\n");
    expect(parseRows(rows).items[0]).toMatchObject({
      sku: "0000563919", ean: "07798013103377", lineTotalCents: 769900,
      discounts: [{ label: "1 *40% MARCAS", tag: "A", amountCents: -307960 }],
    });
  });

  it("tolerates a stray period or comma glued between the sku and the ean", () => {
    const rows = parseRowsText("CEBOLLA\n0000000602. 02500602003242\t647,68\n");
    expect(parseRows(rows).items[0]).toMatchObject({ sku: "0000000602", ean: "02500602003242" });
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

  it("reads a closing bracket misread as J", () => {
    const rows = parseRowsText("X\n0000000001 000000000001\t1,00\nMERCADO PAGO 25% - V [MJ\t-0,25\n");
    expect(parseRows(rows).items[0].discounts).toEqual([{ label: "MERCADO PAGO 25% - V", tag: "M", amountCents: -25 }]);
  });

  it("recovers the line total when box-grouping put it on the discount row: the amount that " +
    "follows a still-open item on a tag row is the line total, and the next bare row is the discount", () => {
    const rows = parseRowsText("X\n0000000001 000000000001\n1 *3X2 CLASES [A]\t9326,97\n\t-3108,99\n");
    expect(parseRows(rows).items[0]).toMatchObject({
      lineTotalCents: 932697, discounts: [{ label: "1 *3X2 CLASES", tag: "A", amountCents: -310899 }],
    });
  });

  it("infers the tag from the label when the bracket tag is dropped entirely", () => {
    const rows = parseRowsText("X\n0000000001 000000000001\t1,00\n1 *25% CLASES\t-874,75\n");
    expect(parseRows(rows).items[0].discounts).toEqual([{ label: "1 *25% CLASES", tag: "A", amountCents: -87475 }]);
  });

  it("waits for a discount's amount when box-grouping split it onto the following bare row", () => {
    const rows = parseRowsText("X\n0000000001 000000000001\t1,00\n1 *25% MARCAS [A]\n\t-25,00\n");
    expect(parseRows(rows).items[0].discounts).toEqual([{ label: "1 *25% MARCAS", tag: "A", amountCents: -2500 }]);
  });

  it("still leaves the line total null for a genuine already-negative discount with no line total anywhere", () => {
    const rows = parseRowsText("X\n0000000001 000000000001\nMERCADO PAGO 25% - V [M]\t-1600,00\n");
    const item = parseRows(rows).items[0];
    expect(item.lineTotalCents).toBeNull();
    expect(item.discounts).toEqual([{ label: "MERCADO PAGO 25% - V", tag: "M", amountCents: -160000 }]);
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
  it("reads TOTAL when Vision glued its period-decimal amount onto the marker's own row", () => {
    const rows = parseRowsText("X\n0000000001 000000000001\t1,00\nSUBTOT. SIN DESCUENTOS\t1,00\n" +
      "DESCUENTOS POR PROMOCIONES\t0,00\nTOTAL 84288.50\n");
    expect(parseRows(rows).footer.totalCents).toBe(8428850);
  });
  it("reads TOTAL when its period-decimal amount landed alone on the following row", () => {
    const rows = parseRowsText("X\n0000000001 000000000001\t1,00\nSUBTOT. SIN DESCUENTOS\t1,00\n" +
      "DESCUENTOS POR PROMOCIONES\t0,00\nTOTAL\n84288.50\n");
    expect(parseRows(rows).footer.totalCents).toBe(8428850);
  });
  it("reads TOTAL when its amount landed on the next row instead of the marker's own row", () => {
    const rows = parseRowsText("X\n0000000001 000000000001\t1,00\nSUBTOT. SIN DESCUENTOS\t1,00\n" +
      "DESCUENTOS POR PROMOCIONES\t0,00\nTOTAL\n\t1,00\n");
    expect(parseRows(rows).footer.totalCents).toBe(100);
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
  it("still anchors on the code when box-grouping glued the next page's description onto it", () => {
    const merged = mergePages(rows(
      "## page 1\nA\n0000000001 000000000001\t1,00\nB\n0000000002 000000000002\t2,00\n" +
      "## page 2\n0000000002 000000000002 B DESC GLUED ON\nC\n0000000003 000000000003\t3,00\n"));
    expect(merged.filter(r => /^\d{10} /.test(r.label)).map(r => r.label.slice(0, 10)))
      .toEqual(["0000000001", "0000000002", "0000000003"]);
  });
  it("keeps the clean copy of a duplicated item's quantity line when page k's own copy is mangled", () => {
    const merged = mergePages(rows(
      "## page 1\nA\n1,4/0 x 2199,00\nB\n0000000001 000000000001\t1,00\n" +
      "## page 2\n1,470 x 2199,00\nB\n0000000001 000000000001\t1,00\nC\n0000000002 000000000002\t2,00\n"));
    expect(merged.map(r => r.label)).toContain("1,470 x 2199,00");
    expect(merged.map(r => r.label)).not.toContain("1,4/0 x 2199,00");
  });
  it("drops the boundary item's page k+1 discount even when its bracket tag was lost too", () => {
    const merged = mergePages(rows(
      "## page 1\nA\n0000000001 000000000001\t1,00\n1 *25% MARCAS [A]\t-0,25\n" +
      "## page 2\n0000000001 000000000001\t1,00\n1 *25% MARCAS\t-0,25\nB\n0000000002 000000000002\t2,00\n"));
    expect(merged.filter(r => /^1 \*25% MARCAS/.test(r.label))).toHaveLength(1);
  });
  it("keeps the clean copy of the boundary code row when page k's own copy is mangled", () => {
    const merged = mergePages(rows(
      "## page 1\nA\n0000000001 000000000001\t1,00\nB\n0000000002 000000000002 3172\n" +
      "## page 2\nB\n0000000002 000000000002\t2,00\nMERCADO PAGO [M]\t-0,50\nC\n0000000003 000000000003\t3,00\n"));
    const boundary = merged.find(r => r.label.startsWith("0000000002"))!;
    expect(boundary).toEqual({ page: 2, label: "0000000002 000000000002", amount: "2,00" });
  });
  it("still anchors when a mid-run code had a '0' misread as a round letter", () => {
    // A real failure mode: page k+1's own scan reads one duplicated item's leading digit as a
    // similarly-round letter ("C" for "0"). Filtering that item's code out entirely (rather than
    // still recognising it) would misalign every code after it and break the whole overlap run.
    const merged = mergePages(rows(
      "## page 1\nA\n0000000001 000000000001\t1,00\nB\nC000000002 000000000002\t2,00\nC\n0000000003 000000000003\t3,00\n" +
      "## page 2\nB\nC000000002 000000000002\t2,00\nC\n0000000003 000000000003\t3,00\nD\n0000000004 000000000004\t4,00\n"));
    expect(merged.filter(r => /^[0-9C]{10} /.test(r.label)).map(r => r.label.slice(0, 10)))
      .toEqual(["0000000001", "C000000002", "0000000003", "0000000004"]);
  });

  it("concatenates pages that do not overlap", () => {
    const merged = mergePages(rows("## page 1\nA\n0000000001 000000000001\t1,00\n## page 2\nTOTAL\t1,00\n"));
    expect(merged).toHaveLength(3);
  });
});
