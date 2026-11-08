"""Parse Mercado Pago credit-card statements (emitted by MercadoLibre S.R.L.).

Same contract as pdf_to_json.parse-family: one PDF in, one JSON-ready dict out,
strict about anything it does not recognise. Three layout generations exist in
the wild and all are handled:

  * 2025-10 ("old"): 3 pages, ARS only, sections "Pagos realizados" /
    "Ajustes y devoluciones", no previous-cycle info.
  * 2025-11 .. 2026-xx ("new"): 5 pages, ARS + USD columns, an "Operación"
    voucher column, the previous cycle either as "Resumen de <mes>" +
    "Pagos realizados" or folded into "Composición del saldo del periodo
    anterior", and "Cierre anterior" on the additional-information page.

MP statements carry NO year anywhere in their text or metadata, so the year is
taken from the filename (e.g. mercadopago_2026_07_18.pdf) and every other date
is derived from the closing date by month arithmetic.
"""

from __future__ import annotations

import re
from pathlib import Path

import pdfplumber

from pdf_to_json import (
    LONG_MONTHS, SHORT_MONTHS, UnknownLayout, line_text, page_lines, strip_accents, to_number,
)

RE_FILENAME_YEAR = re.compile(r"(20\d{2})")
RE_DAY_OF_MONTH = re.compile(r"(\d{1,2}) de ([a-záéíóú]+)", re.IGNORECASE)
# 6/oct MERPAGO*COTO [1 de 3] [141585] $ 33.216,64 [US$ 0,00] — every detail row.
RE_MOVEMENT = re.compile(
    r"^(?P<day>\d{1,2})/(?P<mon>[a-záéíóú]{3,5})\.?\s+"
    r"(?P<desc>.+?)"
    r"(?:\s+(?P<inst_n>\d{1,2}) de (?P<inst_m>\d{1,2}))?"
    r"(?:\s+(?P<voucher>\d{6}))?"
    r"(?:\s+(?P<ars_sign>-?)\$\s*(?P<ars>[\d.,]+))?"
    r"(?:\s+(?P<usd_sign>-?)US\$\s*(?P<usd>[\d.,]+))?$",
    re.IGNORECASE,
)
# Header amounts render their cents as superscript, so extraction glues them
# onto the integer part with the comma lost: "829.74536" means 829.745,36.
RE_GLUED_CENTS = re.compile(r"^(\d{1,3}(?:\.\d{3})*|\d)(\d{2})$")
RE_AMOUNT_PAIR = re.compile(r"(-?)\$\s*([\d.,]+)")
RE_USD_PAIR = re.compile(r"(-?)US\$\s*([\d.,]+)")
RE_LIMIT = re.compile(r"\$\s*[\d.,]+\s*de\s*\$\s*([\d.,]+)")
RE_RATE_TNA = re.compile(r"TNA\s+(\d+(?:,\d+)?)%")
RE_RATE_TEA = re.compile(r"TEA\s+(\d+(?:,\d+)?)%")
RE_CARDHOLDER = re.compile(r"Este resumen pertenece a\s+(.+?)\s*,\s*CUIT")

SECTION_HEADERS = {
    "COMPOSICION DEL SALDO DEL PERIODO ANTERIOR": "previous",
    "PAGOS REALIZADOS": "payments",
    "PAGOS ANTICIPADOS": "payments",
    "CONSUMOS": "purchases",
    "IMPUESTOS E INTERESES": "taxes_and_charges",
    "AJUSTES Y REEMBOLSOS": "adjustments",
    "AJUSTES Y DEVOLUCIONES": "adjustments",
}
# Lines that structure a section but are not movements.
SKIP_PREFIXES = (
    "DETALLE DE MOVIMIENTOS", "FECHA DESCRIPCION", "CON TARJETA",
    "NO TENES", "NO REALIZASTE",
)

KEY_ORDER = ["file", "brand", "product", "account", "cardholder", "period", "balances",
             "limits", "rates", "upcoming_installments", "transactions", "declared_totals"]


def norm_line(line: list[dict]) -> str:
    return re.sub(r"\s+", " ", strip_accents(line_text(line))).strip().upper()


def month_number(name: str, context: str) -> int:
    key = strip_accents(name).lower()
    if key in LONG_MONTHS:
        return LONG_MONTHS[key]
    if key in SHORT_MONTHS or key.rstrip(".") in SHORT_MONTHS:
        return SHORT_MONTHS.get(key, SHORT_MONTHS.get(key.rstrip(".")))
    if key == "sept":
        return 9
    raise UnknownLayout(f"unrecognised month name: {name!r} {context}")


def glued_amount(token: str, context: str) -> float:
    m = RE_GLUED_CENTS.match(token)
    if not m:
        raise UnknownLayout(f"unrecognised header amount: {token!r} {context}")
    return float(m.group(1).replace(".", "")) + int(m.group(2)) / 100


def iso(year: int, month: int, day: int) -> str:
    return f"{year:04d}-{month:02d}-{day:02d}"


def shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def tx_year(month: int, closing_year: int, closing_month: int) -> int:
    """A movement dated after the closing month belongs to the previous year."""
    return closing_year - 1 if month > closing_month else closing_year


def parse(pdf_path: Path) -> dict:
    year_match = RE_FILENAME_YEAR.search(pdf_path.stem)
    if not year_match:
        raise UnknownLayout(
            f"{pdf_path.name}: Mercado Pago statements carry no year in their text; "
            "the filename must include one, e.g. mercadopago_2026_07_18.pdf")
    file_year = int(year_match.group(1))

    with pdfplumber.open(pdf_path) as pdf:
        pages = [page_lines(p) for p in pdf.pages]
        raw_pages = [p.extract_text() or "" for p in pdf.pages]
        info_halves = None
        for i, text in enumerate(raw_pages):
            # The "INFORMACIÓN ADICIONAL" header repeats on the legal-text
            # continuation page, so anchor on the billing-cycle block instead.
            if "Ciclo de facturaci" in text:
                page = pdf.pages[i]
                info_halves = (
                    page.crop((0, 0, page.width / 2, page.height)).extract_text() or "",
                    page.crop((page.width / 2, 0, page.width, page.height)).extract_text() or "",
                )
                break
        if info_halves is None:
            raise UnknownLayout(f"{pdf_path.name}: no billing-cycle page")

    first_text = raw_pages[0]
    if "Este es tu resumen" not in first_text:
        raise UnknownLayout(f"{pdf_path.name}: not a Mercado Pago statement")

    info_text = "\n".join(info_halves)
    period = parse_period(info_text, file_year, pdf_path.name)
    closing_year = int(period["closing_date"][:4])
    closing_month = int(period["closing_date"][5:7])

    balances, declared = parse_consolidado(pages[0], pdf_path.name)
    balances["minimum_payment_ars"] = parse_minimum(pages[0], pdf_path.name)

    transactions, prev_gross = parse_movements(pages, closing_year, closing_month, pdf_path.name)
    if prev_gross is not None:
        # The Consolidado's "Saldo del periodo anterior" is sometimes net of the
        # payment; the detail section carries the previous statement's gross
        # balance, which is what the DB stores (BBVA semantics).
        balances["previous_ars"] = prev_gross
    check_totals(transactions, declared, balances, pdf_path.name)

    limits = {"purchase": None}
    limit_match = RE_LIMIT.search(info_text.replace("\n", " "))
    if limit_match:
        limits["purchase"] = to_number(limit_match.group(1))

    cardholder = None
    holder_match = RE_CARDHOLDER.search(" ".join(raw_pages))
    if holder_match:
        cardholder = re.sub(r"\s+", " ", holder_match.group(1)).strip()

    data = {
        "file": pdf_path.name,
        "brand": "mercadopago",
        "product": "Mercado Pago",
        "account": None,
        "cardholder": cardholder,
        "period": period,
        "balances": balances,
        "limits": limits,
        "rates": parse_rates(info_halves),
        "upcoming_installments": project_installments(transactions, closing_year, closing_month),
        "transactions": transactions,
        "declared_totals": [
            {"concept": "TOTAL CONSUMOS", "block": 1,
             "ars": declared.get("purchases_ars"), "usd": declared.get("purchases_usd")},
            {"concept": "SALDO ACTUAL", "block": None,
             "ars": balances["current_ars"], "usd": balances["current_usd"]},
        ],
    }
    return {k: data[k] for k in KEY_ORDER}


def parse_period(info_text: str, file_year: int, filename: str) -> dict:
    flat = re.sub(r"\s+", " ", info_text)

    def find_date(label: str):
        m = re.search(label + r"\s+(\d{1,2}) de ([a-záéíóú]+)", flat, re.IGNORECASE)
        if not m:
            return None
        return int(m.group(1)), month_number(m.group(2), f"({label}, {filename})")

    closing = find_date("Cierre actual")
    due = find_date("Vencimiento actual")
    if closing is None or due is None:
        raise UnknownLayout(f"{filename}: closing/due dates not found on the info page")
    closing_day, closing_month = closing

    period = {"closing_date": iso(file_year, closing_month, closing_day)}
    due_day, due_month = due
    # MP due dates fall a few days after closing in the same month, but be
    # defensive about a December statement due in January.
    due_year = file_year + 1 if due_month < closing_month else file_year
    period["due_date"] = iso(due_year, due_month, due_day)

    prev = find_date("Cierre anterior")
    if prev is not None:
        prev_day, prev_month = prev
        prev_year = file_year - 1 if prev_month > closing_month else file_year
        period["previous_closing_date"] = iso(prev_year, prev_month, prev_day)
    else:
        period["previous_closing_date"] = None
    return period


def parse_minimum(header_lines: list[list[dict]], filename: str) -> float:
    # The due date from the page's right column can merge into this visual line,
    # so take the glued-cents token that follows the "es$" marker, not the last one.
    for line in header_lines:
        if not norm_line(line).startswith("EL MINIMO A PAGAR"):
            continue
        seen_marker = False
        for word in line:
            if word["text"].endswith("$"):
                seen_marker = True
                continue
            if seen_marker and RE_GLUED_CENTS.match(word["text"]):
                return glued_amount(word["text"], f"(mínimo, {filename})")
    raise UnknownLayout(f"{filename}: minimum payment line not found")


def parse_consolidado(header_lines: list[list[dict]], filename: str) -> tuple[dict, dict]:
    """Read the Consolidado box on page one: balances plus declared totals."""
    balances = {"previous_ars": None, "current_ars": None, "current_usd": None}
    declared: dict = {}
    in_box = False
    for line in header_lines:
        text = re.sub(r"\s+", " ", line_text(line)).strip()
        label = norm_line(line)
        if label == "CONSOLIDADO":
            in_box = True
            continue
        if not in_box:
            continue
        ars_m = RE_AMOUNT_PAIR.search(re.sub(r"US\$\s*[\d.,]+", "", text))
        usd_m = RE_USD_PAIR.search(text)
        if ars_m is None:
            continue
        ars = to_number(ars_m.group(1) + ars_m.group(2))
        usd = to_number(usd_m.group(1) + usd_m.group(2)) if usd_m else None
        if label.startswith("RESUMEN DE") or label.startswith("SALDO DEL PERIODO ANTERIOR"):
            balances["previous_ars"] = ars
        elif label.startswith("CONSUMOS"):
            declared["purchases_ars"], declared["purchases_usd"] = ars, usd
        elif label.startswith("IMPUESTOS E INTERESES"):
            declared["taxes_ars"] = ars
        elif label.startswith("AJUSTES Y"):
            declared["adjustments_ars"] = ars
        elif label.startswith("PAGOS "):
            declared.setdefault("payments_ars", 0.0)
            declared["payments_ars"] = round(declared["payments_ars"] + (ars or 0), 2)
        elif label.startswith("TOTAL A PAGAR"):
            balances["current_ars"], balances["current_usd"] = ars, usd
            break
    if balances["current_ars"] is None or "purchases_ars" not in declared:
        raise UnknownLayout(f"{filename}: Consolidado box not fully parsed")
    return balances, declared


def parse_movements(pages, closing_year: int, closing_month: int,
                    filename: str) -> tuple[list[dict], float | None]:
    transactions: list[dict] = []
    prev_gross: float | None = None
    mode: str | None = None
    for page in pages:
        header = norm_line(page[0]) if page else ""
        if header != "DETALLE DE MOVIMIENTOS":
            continue
        for line in page[1:]:
            label = norm_line(line)
            if label in SECTION_HEADERS:
                mode = SECTION_HEADERS[label]
                continue
            if re.fullmatch(r"RESUMEN DE [A-Z]+", label):
                mode = "previous"
                continue
            if label.startswith(SKIP_PREFIXES) or label.startswith("SUBTOTAL") \
                    or label.startswith("TOTAL A PAGAR"):
                continue
            text = re.sub(r"\s+", " ", line_text(line)).strip()
            m = RE_MOVEMENT.match(text)
            if not m or (m.group("ars") is None and m.group("usd") is None):
                raise UnknownLayout(f"{filename}: unrecognised movement line: {text!r}")
            if mode is None:
                raise UnknownLayout(f"{filename}: movement before any section header: {text!r}")
            desc = m.group("desc").strip()
            norm_desc = strip_accents(desc).upper()
            month = month_number(m.group("mon"), f"({filename})")
            ars = to_number((m.group("ars_sign") or "") + m.group("ars")) if m.group("ars") else None
            usd = to_number((m.group("usd_sign") or "") + m.group("usd")) if m.group("usd") else None
            if mode == "previous" and (norm_desc.startswith("RESUMEN DE")
                                       or norm_desc.startswith("TOTAL A PAGAR")):
                # Informational, not a movement: the previous cycle's gross balance.
                prev_gross = ars
                continue
            section = mode
            if mode == "previous":
                if not norm_desc.startswith("PAGO"):
                    raise UnknownLayout(f"{filename}: unexpected row in previous-balance section: {text!r}")
                section = "payments"
            elif mode == "adjustments":
                section = "payments"
            transactions.append({
                "section": section,
                "block": 1 if section == "purchases" else None,
                "block_cardholder": None,
                "date": iso(tx_year(month, closing_year, closing_month), month, int(m.group("day"))),
                "description": desc,
                "voucher": m.group("voucher"),
                "ars": ars,
                "usd": usd,
                "installment_number": int(m.group("inst_n")) if m.group("inst_n") else None,
                "installment_count": int(m.group("inst_m")) if m.group("inst_m") else None,
                "raw_line": text,
            })
    return transactions, prev_gross


def check_totals(transactions, declared, balances, filename: str) -> None:
    def section_sum(section):
        return round(sum(t["ars"] or 0 for t in transactions if t["section"] == section), 2)

    actual = section_sum("purchases")
    if abs(actual - declared["purchases_ars"]) > 0.05:
        raise UnknownLayout(
            f"{filename}: consumos add up to {actual} but the Consolidado declares "
            f"{declared['purchases_ars']}")
    if declared.get("taxes_ars") is not None:
        actual = section_sum("taxes_and_charges")
        if abs(actual - declared["taxes_ars"]) > 0.05:
            raise UnknownLayout(
                f"{filename}: taxes add up to {actual} but the Consolidado declares "
                f"{declared['taxes_ars']}")

    # The whole statement in one equation: previous gross balance, payments and
    # adjustments (both negative), purchases and taxes must land on Total a pagar.
    parts = round((balances["previous_ars"] or 0) + section_sum("payments")
                  + section_sum("purchases") + section_sum("taxes_and_charges"), 2)
    if abs(parts - balances["current_ars"]) > 0.05:
        raise UnknownLayout(
            f"{filename}: sections add up to {parts} but Total a pagar is {balances['current_ars']}")


def parse_rates(info_halves: tuple[str, str]) -> dict:
    """Financing TNA/TEA live in one column of the two-column info page; cropping
    halves keeps the punitive-interest block from interleaving with them."""
    rates = {"annual_nominal_ars": None, "annual_nominal_usd": None,
             "monthly_effective_ars": None, "monthly_effective_usd": None}
    for half in info_halves:
        flat = re.sub(r"\s+", " ", strip_accents(half))
        marker = flat.find("financiacion del resumen actual")
        if marker < 0:
            continue
        window = flat[marker:marker + 250]
        tna, tea = RE_RATE_TNA.search(window), RE_RATE_TEA.search(window)
        if tna:
            rates["annual_nominal_ars"] = to_number(tna.group(1))
        if tea:
            tea_value = to_number(tea.group(1))
            # MP quotes TEA, the DB wants the monthly effective rate; the two are
            # exactly related by compounding.
            rates["monthly_effective_ars"] = round(((1 + tea_value / 100) ** (1 / 12) - 1) * 100, 3)
        break
    return rates


def project_installments(transactions, closing_year: int, closing_month: int) -> list[dict]:
    """MP prints no forward installment table, but every 'n de m' consumo repeats
    its cycle amount for the remaining m-n months (MP bills equal installments)."""
    per_month: dict[str, float] = {}
    for t in transactions:
        if t["section"] != "purchases" or not t["installment_count"]:
            continue
        remaining = t["installment_count"] - (t["installment_number"] or 0)
        for k in range(1, remaining + 1):
            y, m = shift_month(closing_year, closing_month, k)
            key = f"{y:04d}-{m:02d}"
            per_month[key] = round(per_month.get(key, 0) + (t["ars"] or 0), 2)
    return [{"month": month, "amount_ars": amount}
            for month, amount in sorted(per_month.items())]
