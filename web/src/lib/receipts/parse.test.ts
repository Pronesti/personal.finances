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

  it("excludes a negative amount on the code row from the line total (a printed total is never " +
    "negative), reattaching it to the bracketed discount label that follows", () => {
    const rows = parseRowsText("BANANA CAVENDISHX KG\t3447,14\n0000000446 02500446008625\t-861,79\n" +
      "MERCADO PAGO 25% - V [M]\n");
    expect(parseRows(rows).items[0]).toMatchObject({
      lineTotalCents: 344714,
      discounts: [{ label: "MERCADO PAGO 25% - V", tag: "M", amountCents: -86179 }],
    });
  });

  it("reattaches a negative code-row amount to an untagged discount label the same way", () => {
    const rows = parseRowsText("GELATINA LIGHT SOB 25 GRM\t1670,00\n0000245683 07622201705011\t-421,01\n" +
      "1 *ROYAL 25%\n");
    expect(parseRows(rows).items[0]).toMatchObject({
      lineTotalCents: 167000,
      discounts: [{ label: "1 *ROYAL 25%", tag: "A", amountCents: -42101 }],
    });
  });

  it("does not let a negative bare amount become an item's line total when no discount label is " +
    "waiting for it either", () => {
    const rows = parseRowsText("X\n0000000001 000000000001\n\t-50,00\n");
    const item = parseRows(rows).items[0];
    expect(item.lineTotalCents).toBeNull();
    expect(parseRows(rows).notes.join(" ")).toContain("stray amount -50,00");
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
  it("does not let a garbled footer with an unread amount null out a good footer that came before it", () => {
    const rows = parseRowsText(
      "X\n0000000001 000000000001\t1,00\n" +
      "SUBTOT. SIN DESCUENTOS\t100,00\nDESCUENTOS POR PROMOCIONES\t-25,00\nTOTAL\t75,00\n" +
      "SUBTOT. SIN DESCUENTOS\nDESCUENTOS POR PROMOCIONES\nTOTAL\n");
    expect(parseRows(rows).footer).toMatchObject({ subtotalCents: 10000, discountsCents: -2500, totalCents: 7500 });
  });
  it("does not let a garbled footer with an unread amount null out a good footer that comes after it", () => {
    const rows = parseRowsText(
      "X\n0000000001 000000000001\t1,00\n" +
      "SUBTOT. SIN DESCUENTOS\nDESCUENTOS POR PROMOCIONES\nTOTAL\n" +
      "SUBTOT. SIN DESCUENTOS\t100,00\nDESCUENTOS POR PROMOCIONES\t-25,00\nTOTAL\t75,00\n");
    expect(parseRows(rows).footer).toMatchObject({ subtotalCents: 10000, discountsCents: -2500, totalCents: 7500 });
  });

  it("disarms awaitingTotal at the next labelled row, so a later stray bare amount doesn't " +
    "silently become the total", () => {
    const rows = parseRowsText(
      "X\n0000000001 000000000001\t1,00\nSUBTOT. SIN DESCUENTOS\t1,00\n" +
      "DESCUENTOS POR PROMOCIONES\t0,00\nTOTAL\nSOME OTHER LABEL\n\t999,99\n");
    expect(parseRows(rows).footer.totalCents).toBeNull();
  });

  it("recovers the subtotal and discounts when their amounts land shifted one row onto the SUBTOT " +
    "marker: a bare amount above it is the true subtotal, and the marker's own amount is really " +
    "the discounts figure", () => {
    const rows = parseRowsText(
      "X\n0000000001 000000000001\t100,00\n" +
      "\t165960,47\nSUBTOT. SIN DESCUENTOS\t38898,84\nDESCUENTOS POR PROMOCIONES\nTOTAL\t127061,63\n");
    expect(parseRows(rows).footer).toMatchObject({
      subtotalCents: 16596047, discountsCents: -3889884, totalCents: 12706163,
    });
  });

  it("recovers the same shift when OCR glues the SUBTOT and DESCUENTOS marker text onto one row", () => {
    const rows = parseRowsText(
      "X\n0000000001 000000000001\t100,00\n" +
      "\t165960,47\nSUBTOT. SIN DESCUENTOS DESCUENTOS POR PROMOCIONES\t38898,84\n" +
      "\t127061,63\nTOTAL\t127061,63\n");
    expect(parseRows(rows).footer).toMatchObject({
      subtotalCents: 16596047, discountsCents: -3889884, totalCents: 12706163,
    });
  });

  it("does not mistake the previous item's own bare discount amount for a shifted subtotal: only a " +
    "positive bare amount above SUBTOT counts, since a subtotal is never negative", () => {
    const rows = parseRowsText(
      "X\n0000000001 000000000001\n1 *35% TROZADOS POLLO [A]\t100,00\n\t-25,00\n" +
      "SUBTOT. SIN DESCUENTOS\t900,00\nDESCUENTOS POR PROMOCIONES\t-25,00\nTOTAL\t875,00\n");
    expect(parseRows(rows).footer).toMatchObject({
      subtotalCents: 90000, discountsCents: -2500, totalCents: 87500,
    });
  });

  it("forces a positive DESCUENTOS reading negative: the discount total is always a subtraction", () => {
    const rows = parseRowsText(
      "X\n0000000001 000000000001\t100,00\n" +
      "SUBTOT. SIN DESCUENTOS\t100,00\nDESCUENTOS POR PROMOCIONES\t25,00\nTOTAL\t75,00\n");
    expect(parseRows(rows).footer.discountsCents).toBe(-2500);
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

  it("bounds tailA at the boundary item's own trailer, dropping page k's footer rather than " +
    "letting it outscore page k+1's real footer on discount count", () => {
    const merged = mergePages(rows(
      "## page 1\nA\n0000000001 000000000001\t1,00\n" +
      "1 *25% MARCAS [A]\t-0,25\n" + // boundary item's own trailer (tailA/tailB candidate)
      "SUBTOT\nDESCUENTOS POR PROMOCIONES\n2 *X\n3 *Y\n4 *Z\n" + // page k's garbled footer: junk plus 3 fake "N *" discounts
      "## page 2\n0000000001 000000000001\t1,00\n1 *25% MARCAS [A]\t-0,25\n" +
      "SUBTOT. SIN DESCUENTOS\t100,00\n"));
    // page k's junk footer (SUBTOT/DESCUENTOS/2 *X/3 *Y/4 *Z) must not survive the merge.
    expect(merged.some(r => /SUBTOT$/.test(r.label))).toBe(false);
    expect(merged.some(r => /^[234] \*/.test(r.label))).toBe(false);
    expect(merged.filter(r => /^1 \*25% MARCAS/.test(r.label))).toHaveLength(1);
    expect(merged.some(r => /^SUBTOT\. SIN DESCUENTOS/.test(r.label))).toBe(true);
  });

  it("reconciles a duplicated item field by field instead of keeping one copy wholesale: the line " +
    "total from whichever copy's own code row the qty × unit price arithmetic confirms, the " +
    "discount from whichever copy's own quantity line parsed cleanly", () => {
    const merged = mergePages(rows(
      "## page 1\n" +
      "1,000 x 200U,: 2661 90\nPALMOLIVE\n0000608115 07509546070988\t7982,97\n" +
      "1 *3X2 JABON TOCADOR [A]\t-2060,99\n" +
      "## page 2\n" +
      "3,000 x 2660,99\nPALMOLIVE\n0000608115 07509546070988\t1982,97\n" +
      "1 *3X2 JABON TOCADOR [A]\t-2660,99\nB\n0000000002 000000000002\t2,00\n"));
    const palmolive = merged.find(r => r.label.startsWith("0000608115"))!;
    // Page 1's line total (7982,97) is corroborated by 3 × 2660,99; page 2's own reading
    // (1982,97, a misread "7") is not — even though page 2's quantity line is the one that
    // parsed, and its own discount (-2660,99) is the one kept.
    expect(palmolive.amount).toBe("7982,97");
    expect(merged.filter(r => /JABON TOCADOR/.test(r.label))).toEqual([
      { page: 2, label: "1 *3X2 JABON TOCADOR [A]", amount: "-2660,99" },
    ]);
  });

  it("concatenates pages that do not overlap", () => {
    const merged = mergePages(rows("## page 1\nA\n0000000001 000000000001\t1,00\n## page 2\nTOTAL\t1,00\n"));
    expect(merged).toHaveLength(3);
  });

  describe("offers-section discount tiebreaker", () => {
    // Same duplicated item as the "reconciles a duplicated item field by field" test above (page
    // 1's quantity line mangled, page 2's clean, so the quantity-line proxy always prefers page
    // 2's discount reading) — except here the offers section shows page 2's reading is the WRONG
    // one and page 1's is right. Without the rule, the proxy still picks page 2's -2660,99;
    // with it, the offers total (2060,99) settles on page 1's -2060,99 instead.
    const disputedItem = (offersBlock: string) => rows(
      "## page 1\n" +
      "1,000 x 200U,: 2661 90\nPALMOLIVE\n0000608115 07509546070988\t7982,97\n" +
      "1 *3X2 JABON TOCADOR [A]\t-2060,99\n" +
      "## page 2\n" +
      "3,000 x 2660,99\nPALMOLIVE\n0000608115 07509546070988\t1982,97\n" +
      "1 *3X2 JABON TOCADOR [A]\t-2660,99\n" +
      offersBlock);

    it("earns its place: rescues a duplicated discount the quantity-line proxy would otherwise " +
      "get wrong, using the offers section total as a tiebreaker between the two OCR readings", () => {
      const notes: string[] = [];
      const merged = mergePages(disputedItem(
        "DETALLE DE OFERTAS APLICADAS\n1 *3X2 JABON TOCADOR\t2060,99\nTOT.AHORRO\t2060,99\n"), notes);
      expect(merged.filter(r => /^1 \*3X2 JABON TOCADOR \[A\]$/.test(r.label))).toEqual([
        { page: 2, label: "1 *3X2 JABON TOCADOR [A]", amount: "-2060,99" },
      ]);
      expect(notes.join(" ")).toContain("JABON TOCADOR");
    });

    it("does not fire when the label is ambiguous: carried by a second discount row elsewhere on " +
      "the receipt", () => {
      const merged = mergePages(disputedItem(
        "ANOTHER ITEM\n0000000009 000000000009\t100,00\n1 *3X2 JABON TOCADOR [A]\t-50,00\n" +
        "DETALLE DE OFERTAS APLICADAS\n1 *3X2 JABON TOCADOR\t2060,99\nTOT.AHORRO\t2060,99\n"));
      const disputed = merged.filter(r => /^1 \*3X2 JABON TOCADOR \[A\]/.test(r.label));
      expect(disputed).toContainEqual({ page: 2, label: "1 *3X2 JABON TOCADOR [A]", amount: "-2660,99" });
    });

    it("does not fire when the label is 'MERCADO PAGO 25% - V' aggregated across several items: " +
      "sharing one offer total is the same ambiguity as two labelled discount rows", () => {
      const merged = mergePages(rows(
        "## page 1\n" +
        "1,000 x 200U,: 2661 90\nPALMOLIVE\n0000608115 07509546070988\t7982,97\n" +
        "MERCADO PAGO 25% - V [M]\t-2060,99\n" +
        "## page 2\n" +
        "3,000 x 2660,99\nPALMOLIVE\n0000608115 07509546070988\t1982,97\n" +
        "MERCADO PAGO 25% - V [M]\t-2660,99\n" +
        "OTHER ITEM\n0000000009 000000000009\t500,00\nMERCADO PAGO 25% - V [M]\t-100,00\n" +
        "DETALLE DE OFERTAS APLICADAS\nMERCADO PAGO 25% - V\t2160,99\nTOT.AHORRO\t2160,99\n"));
      const disputed = merged.filter(r => /^MERCADO PAGO 25% - V \[M\]/.test(r.label));
      expect(disputed).toContainEqual({ page: 2, label: "MERCADO PAGO 25% - V [M]", amount: "-2660,99" });
    });

    it("does not fire when neither OCR reading matches the printed offer total (garbled offers " +
      "row): the existing quantity-line proxy still decides", () => {
      const merged = mergePages(disputedItem(
        "DETALLE DE OFERTAS APLICADAS\n1 *3X2 JABON TOCADOR\t9999,99\nTOT.AHORRO\t9999,99\n"));
      expect(merged.filter(r => /^1 \*3X2 JABON TOCADOR \[A\]$/.test(r.label))).toEqual([
        { page: 2, label: "1 *3X2 JABON TOCADOR [A]", amount: "-2660,99" },
      ]);
    });
  });
});
