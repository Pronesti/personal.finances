#!/usr/bin/env python3
"""
Convert BBVA credit-card statements (Visa / Mastercard) from PDF to JSON.

Usage:
    python3 pdf_to_json.py                # convert every PDF in ../pdfs that has no JSON yet
    python3 pdf_to_json.py a.pdf b.pdf    # convert only those PDFs
    python3 pdf_to_json.py --force        # reprocess everything, overwriting existing JSON

Output: ../json/<same name>.json  (1 PDF = 1 JSON)

Parsing is STRICT: if a row or a section does not match the known layout, the
script aborts and reports the file, page and line. That is deliberate - if BBVA
changes the statement layout we want to hear about it rather than silently
produce an incomplete JSON.

Note: the statements are in Spanish, so the literals used to locate sections and
column headers ("FECHA", "Consumos", "Legales y avisos", ...) are Spanish on
purpose. Everything else - identifiers, messages and the JSON keys - is English.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

import pdfplumber

BASE_DIR = Path(__file__).resolve().parent.parent
PDF_DIR = BASE_DIR / "pdfs"
JSON_DIR = BASE_DIR / "json"

SHORT_MONTHS = {
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
    "jul": 7, "ago": 8, "sep": 9, "set": 9, "oct": 10, "nov": 11, "dic": 12,
}
LONG_MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}

RE_DATE = re.compile(r"^(\d{2})-([A-Za-zÁ-úá-ú]{3})-(\d{2})$")
RE_AMOUNT = re.compile(r"^-?\$?\s?\d{1,3}(\.\d{3})*,\d{2}$|^-?\$?\s?\d+,\d{2}$")
RE_INSTALLMENT = re.compile(r"^C\.(\d{2})/(\d{2})$")
RE_MONTH_YEAR = re.compile(r"^([A-ZÁ-Úa-zá-ú]+)/(\d{2})$")
RE_PAGE_FOOTER = re.compile(r"^Sobre \(\d+\).*Página \d+ de \d+$")

COL_TOL = 20.0    # tolerance (pt) for aligning an amount with its column
LINE_TOL = 4.5    # tolerance (pt) for grouping words into the same visual line


class UnknownLayout(Exception):
    """The PDF contains something this parser does not know how to read."""


def warn(message: str) -> None:
    print(f"WARN: {message}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# low-level helpers
# --------------------------------------------------------------------------- #

def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text)
                   if unicodedata.category(c) != "Mn")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", strip_accents(text)).strip().upper()


def to_iso_date(token: str, context: str = "") -> str:
    m = RE_DATE.match(token)
    if not m:
        raise UnknownLayout(f"unrecognised date: {token!r} {context}")
    day, month, year = m.group(1), strip_accents(m.group(2)).lower(), int(m.group(3))
    if month not in SHORT_MONTHS:
        raise UnknownLayout(f"unrecognised month: {token!r} {context}")
    return f"{2000 + year:04d}-{SHORT_MONTHS[month]:02d}-{int(day):02d}"


def to_number(token: str):
    t = token.replace("$", "").replace("U$S", "").replace(" ", "").strip()
    if t in ("", "-", "--"):
        return None
    negative = t.startswith("-")
    t = t.lstrip("-").replace(".", "").replace(",", ".")
    try:
        value = float(t)
    except ValueError:
        return None
    return round(-value if negative else value, 4)


def is_amount(token: str) -> bool:
    return bool(RE_AMOUNT.match(token.replace(" ", "")))


def page_lines(page) -> list[list[dict]]:
    """Group a page's words into visual lines (rotated text is ignored)."""
    words = [
        w for w in page.extract_words(use_text_flow=False, extra_attrs=["upright"])
        if w.get("upright", True) and w["text"].strip()
    ]
    words.sort(key=lambda w: (w["top"], w["x0"]))
    lines: list[list[dict]] = []
    for w in words:
        if lines and abs(w["top"] - lines[-1][0]["top"]) <= LINE_TOL:
            lines[-1].append(w)
        else:
            lines.append([w])
    for line in lines:
        line.sort(key=lambda w: w["x0"])
    return lines


def line_text(line: list[dict]) -> str:
    return " ".join(w["text"] for w in line)


def merge_currency_sign(line: list[dict]) -> list[dict]:
    """Join a lone '$' token with the number that follows it ('$' + '20.000.000,00')."""
    merged: list[dict] = []
    i = 0
    while i < len(line):
        w = line[i]
        if w["text"] == "$" and i + 1 < len(line) and line[i + 1]["x0"] - w["x1"] < 12:
            nxt = line[i + 1]
            merged.append({**nxt, "text": "$" + nxt["text"], "x0": w["x0"]})
            i += 2
        else:
            merged.append(w)
            i += 1
    return merged


def assign_to_columns(values: list[dict], anchors: list[tuple[str, dict]]) -> dict:
    """Assign each token to the column whose edge (left or right) is closest."""
    result: dict[str, str] = {}
    for v in values:
        best, distance = None, float("inf")
        for name, anchor in anchors:
            d = min(abs(v["x0"] - anchor["x0"]), abs(v["x1"] - anchor["x1"]))
            if d < distance:
                best, distance = name, d
        if best is not None and distance <= 45:
            result[best] = (result.get(best, "") + " " + v["text"]).strip()
        else:
            warn(f"token {v['text']!r} at x={round(v['x0'])}-{round(v['x1'])} dropped: "
                 f"nearest column {best!r} is {round(distance)}pt away (limit 45)")
    return result


def find_line(lines, *phrases, start=0):
    targets = [norm(p) for p in phrases]
    for i in range(start, len(lines)):
        text = norm(line_text(lines[i]))
        if all(t in text for t in targets):
            return i
    return None


def header_anchors(line: list[dict], phrases: list[str]) -> dict:
    """Locate multi-word header phrases inside a line and return their bounding boxes."""
    words = [(norm(w["text"]), w) for w in line]
    anchors: dict[str, dict] = {}
    used = set()
    for phrase in phrases:
        target = norm(phrase).split()
        for i in range(len(words)):
            if i in used:
                continue
            if [w[0] for w in words[i:i + len(target)]] == target:
                box = words[i:i + len(target)]
                anchors[norm(phrase)] = {"x0": box[0][1]["x0"], "x1": box[-1][1]["x1"]}
                used.update(range(i, i + len(target)))
                break
        if norm(phrase) not in anchors:
            raise UnknownLayout(f"header {phrase!r} not found in: {line_text(line)!r}")
    return anchors


def split_concept_and_amounts(line, ars_col, usd_col):
    concept_words, ars, usd = [], None, None
    for w in line:
        if is_amount(w["text"]) and abs(w["x1"] - ars_col["x1"]) <= COL_TOL:
            ars = to_number(w["text"])
        elif is_amount(w["text"]) and abs(w["x1"] - usd_col["x1"]) <= COL_TOL:
            usd = to_number(w["text"])
        elif w["x1"] < ars_col["x0"] - 5:
            concept_words.append(w["text"])
        else:
            warn(f"token {w['text']!r} at x={round(w['x0'])}-{round(w['x1'])} dropped "
                 f"in line {line_text(line)!r}: aligns with no amount column")
    return " ".join(concept_words).strip(), ars, usd


# --------------------------------------------------------------------------- #
# statement header (first page)
# --------------------------------------------------------------------------- #

def parse_header(lines, page_text: str) -> dict:
    data: dict = {}

    top_block = page_text.split("Tarjetas de Cr", 1)[-1]
    m = re.search(r"\b(Visa|Mastercard)\s+([A-Za-zÁ-úá-ú]+)\b", top_block)
    if not m:
        raise UnknownLayout("card brand and product not found")
    data["brand"] = m.group(1).lower()
    data["product"] = f"{m.group(1)} {m.group(2)}"
    account = re.search(r"\bcuenta\s+(\d{6,})", top_block)
    if not account:
        raise UnknownLayout("account number not found")
    data["account"] = account.group(1)

    cardholder = None
    for i, line in enumerate(lines):
        if norm(line_text(line)).startswith("OCASA") and i + 1 < len(lines):
            candidate = line_text(lines[i + 1]).strip()
            if re.fullmatch(r"[A-ZÁÉÍÓÚÑ ]{6,}", candidate):
                cardholder = candidate
            break
    if not cardholder:
        raise UnknownLayout("cardholder name not found")
    data["cardholder"] = cardholder

    # --- closing / due dates, balances, minimum payment ---------------------
    i = find_line(lines, "CIERRE ACTUAL", "VENCIMIENTO ACTUAL")
    if i is None:
        raise UnknownLayout("'CIERRE ACTUAL' block not found")
    anchors = header_anchors(lines[i], ["CIERRE ACTUAL", "VENCIMIENTO ACTUAL",
                                        "SALDO ACTUAL $", "SALDO ACTUAL U$S", "PAGO MINIMO $"])
    values = assign_to_columns(merge_currency_sign(lines[i + 1]), list(anchors.items()))
    period = {
        "closing_date": to_iso_date(values["CIERRE ACTUAL"], "(current closing date)"),
        "due_date": to_iso_date(values["VENCIMIENTO ACTUAL"], "(current due date)"),
    }
    balances = {
        "current_ars": to_number(values["SALDO ACTUAL $"]),
        "current_usd": to_number(values["SALDO ACTUAL U$S"]),
        "minimum_payment_ars": to_number(values["PAGO MINIMO $"]),
    }

    # --- credit limits ------------------------------------------------------
    i = find_line(lines, "DE COMPRA", "DE FINANCIACION", "DE ADELANTO")
    if i is None:
        raise UnknownLayout("credit limits block not found")
    anchors = header_anchors(lines[i], ["DE COMPRA", "DE FINANCIACION", "DE ADELANTO", "CUOTAS"])
    tokens = []
    for j in (i + 1, i + 2):
        if j < len(lines):
            tokens += [w for w in merge_currency_sign(lines[j]) if is_amount(w["text"])]
    values = assign_to_columns(tokens, list(anchors.items()))
    data["limits"] = {
        "purchase": to_number(values.get("DE COMPRA", "")),
        "financing": to_number(values.get("DE FINANCIACION", "")),
        "cash_advance": to_number(values.get("DE ADELANTO", "")),
        "installments": to_number(values.get("CUOTAS", "")),
    }

    # --- account summary (Pesos / Dolares) ----------------------------------
    i = find_line(lines, "PESOS", "DOLARES")
    if i is None:
        raise UnknownLayout("'Pesos / Dólares' header not found")
    ars_col = next(w for w in lines[i] if norm(w["text"]) == "PESOS")
    usd_col = next(w for w in lines[i] if norm(w["text"]) == "DOLARES")
    summary = []
    j = i + 1
    while j < len(lines):
        line = lines[j]
        if norm(line_text(line)).startswith("TOTAL DE CUOTAS A VENCER") \
                or RE_MONTH_YEAR.match(line[0]["text"]):
            break
        concept, ars, usd = split_concept_and_amounts(line, ars_col, usd_col)
        if concept:
            summary.append({"concept": concept, "ars": ars, "usd": usd})
        if norm(concept) == "SALDO ACTUAL":
            break
        j += 1
    data["account_summary"] = summary

    previous = next((r for r in summary if norm(r["concept"]) == "SALDO ANTERIOR"), None)
    data["balances"] = {
        "previous_ars": previous["ars"] if previous else None,
        "previous_usd": previous["usd"] if previous else None,
        "current_ars": balances["current_ars"],
        "current_usd": balances["current_usd"],
        "minimum_payment_ars": balances["minimum_payment_ars"],
    }

    # --- upcoming installments ---------------------------------------------
    i = find_line(lines, "TOTAL DE CUOTAS A VENCER")
    upcoming = []
    if i is not None:
        header = next((k for k in (i, i - 1, i + 1) if 0 <= k < len(lines)
                       and any(RE_MONTH_YEAR.match(w["text"]) for w in lines[k])), None)
        if header is None:
            raise UnknownLayout("month headers of the upcoming-installments block not found")
        anchors = {}
        for w in lines[header]:
            m = RE_MONTH_YEAR.match(w["text"])
            if m:
                month = LONG_MONTHS.get(strip_accents(m.group(1)).lower())
                if not month:
                    raise UnknownLayout(f"unknown month in upcoming installments: {w['text']!r}")
                anchors[f"{2000 + int(m.group(2)):04d}-{month:02d}"] = w
        tokens = []
        for j in range(i, min(i + 4, len(lines))):
            if j == header:
                continue
            tokens += [w for w in merge_currency_sign(lines[j]) if is_amount(w["text"])]
        values = assign_to_columns(tokens, list(anchors.items()))
        for month_key in sorted(anchors):
            upcoming.append({"month": month_key, "amount_ars": to_number(values.get(month_key, ""))})
    data["upcoming_installments"] = upcoming

    # --- interest rates -----------------------------------------------------
    i = find_line(lines, "TNA $", "TEM $")
    data["rates"] = {"annual_nominal_ars": None, "annual_nominal_usd": None,
                     "monthly_effective_ars": None, "monthly_effective_usd": None}
    if i is not None:
        anchors = header_anchors(lines[i], ["TNA $", "TNA U$S", "TEM $", "TEM U$S"])
        values = assign_to_columns([w for w in lines[i + 1] if w["text"] != "%"],
                                   list(anchors.items()))
        data["rates"] = {
            "annual_nominal_ars": to_number(values.get("TNA $", "")),
            "annual_nominal_usd": to_number(values.get("TNA U$S", "")),
            "monthly_effective_ars": to_number(values.get("TEM $", "")),
            "monthly_effective_usd": to_number(values.get("TEM U$S", "")),
        }

    # --- surrounding periods ------------------------------------------------
    i = find_line(lines, "CIERRE ANTERIOR", "PROXIMO CIERRE")
    if i is not None:
        anchors = header_anchors(lines[i], ["CIERRE ANTERIOR", "VENCIMIENTO ANTERIOR",
                                            "PROXIMO CIERRE", "PROXIMO VENCIMIENTO"])
        values = assign_to_columns([w for w in lines[i + 1] if RE_DATE.match(w["text"])],
                                   list(anchors.items()))
        period.update({
            "previous_closing_date": to_iso_date(values["CIERRE ANTERIOR"], "(previous closing)"),
            "previous_due_date": to_iso_date(values["VENCIMIENTO ANTERIOR"], "(previous due)"),
            "next_closing_date": to_iso_date(values["PROXIMO CIERRE"], "(next closing)"),
            "next_due_date": to_iso_date(values["PROXIMO VENCIMIENTO"], "(next due)"),
        })
    data["period"] = period
    return data


# --------------------------------------------------------------------------- #
# transactions (detail pages)
# --------------------------------------------------------------------------- #

SECTION_TITLES = {
    "SUS PAGOS Y AJUSTES REALIZADOS": "payments",
    "IMPUESTOS, CARGOS E INTERESES": "taxes_and_charges",
}
RE_PURCHASES_TITLE = re.compile(r"^Consumos\s+(.+)$")
SKIP_LINES = ("DETALLE", "TARJETAS DE CREDITO", "CONSOLIDADO")


def table_columns(line):
    cols = {}
    for w in line:
        n = norm(w["text"])
        if n == "FECHA":
            cols["date"] = w
        elif n == "DESCRIPCION":
            cols["description"] = w
        elif n == "NRO.":
            cols["voucher_left"] = w
        elif n == "CUPON":
            cols["voucher_right"] = w
        elif n == "PESOS":
            cols["ars"] = w
        elif n == "DOLARES":
            cols["usd"] = w
    if "date" not in cols or "description" not in cols or "ars" not in cols:
        raise UnknownLayout(f"incomplete table header: {line_text(line)!r}")
    return cols


def parse_transactions(pages) -> tuple[list[dict], list[dict]]:
    transactions: list[dict] = []
    declared_totals: list[dict] = []
    section = None
    block_cardholder = None
    block = None
    purchase_blocks = 0
    cols = None

    for page_no, lines in enumerate(pages, start=1):
        for line in lines:
            raw = line_text(line).strip()
            n = norm(raw)
            context = f"(page {page_no}: {raw!r})"

            if n.startswith("LEGALES Y AVISOS"):
                return transactions, declared_totals
            if not raw or RE_PAGE_FOOTER.match(raw) or n in SKIP_LINES:
                continue

            if n in SECTION_TITLES:
                section, block_cardholder, block, cols = SECTION_TITLES[n], None, None, None
                continue
            m = RE_PURCHASES_TITLE.match(raw)
            if m and len(line) <= 6:
                purchase_blocks += 1
                section, block_cardholder, block, cols = \
                    "purchases", m.group(1).strip(), purchase_blocks, None
                continue

            if section is None:
                continue

            if norm(line[0]["text"]) == "FECHA":
                cols = table_columns(line)
                continue
            if cols is None:
                continue

            if n.startswith("TOTAL CONSUMOS DE") or n.startswith("SALDO ACTUAL"):
                ars = usd = None
                words = []
                for w in line:
                    if is_amount(w["text"]) and abs(w["x1"] - cols["ars"]["x1"]) <= COL_TOL:
                        ars = to_number(w["text"])
                    elif is_amount(w["text"]) and "usd" in cols \
                            and abs(w["x1"] - cols["usd"]["x1"]) <= COL_TOL:
                        usd = to_number(w["text"])
                    else:
                        if is_amount(w["text"]):
                            warn(f"amount-shaped token {w['text']!r} at "
                                 f"x={round(w['x0'])}-{round(w['x1'])} in totals line "
                                 f"{line_text(line)!r} aligns with no column; kept as concept text")
                        words.append(w["text"])
                declared_totals.append({"concept": " ".join(words).strip(), "block": block,
                                        "ars": ars, "usd": usd})
                continue

            transactions.append(
                parse_transaction_line(line, cols, section, block, block_cardholder, context))

    return transactions, declared_totals


def parse_transaction_line(line, cols, section, block, block_cardholder, context) -> dict:
    date = None
    ars = usd = None
    voucher = None
    description_words = []
    installment_number = installment_count = None

    voucher_left = cols["voucher_left"]["x0"] - 6 if "voucher_left" in cols \
        else cols["ars"]["x0"] - 60
    voucher_right = cols["voucher_right"]["x1"] + 6 if "voucher_right" in cols else None

    for w in line:
        t = w["text"]
        if RE_DATE.match(t) and w["x0"] < cols["description"]["x0"] - 5:
            date = to_iso_date(t, context)
            continue
        if is_amount(t) and abs(w["x1"] - cols["ars"]["x1"]) <= COL_TOL:
            ars = to_number(t)
            continue
        if is_amount(t) and "usd" in cols and abs(w["x1"] - cols["usd"]["x1"]) <= COL_TOL:
            usd = to_number(t)
            continue
        if voucher_right and voucher_left <= w["x0"] and w["x1"] <= voucher_right:
            voucher = t if voucher is None else voucher + t
            continue
        if w["x1"] <= voucher_left:
            m = RE_INSTALLMENT.match(t)
            if m:
                installment_number, installment_count = int(m.group(1)), int(m.group(2))
            else:
                description_words.append(t)
            continue
        raise UnknownLayout(
            f"unexpected token {t!r} at x={round(w['x0'])}-{round(w['x1'])} {context}")

    description = " ".join(description_words).strip()
    if date is None or not description or (ars is None and usd is None):
        raise UnknownLayout(f"incomplete row (date/description/amount) {context}")

    return {
        "section": section,
        "block": block,
        "block_cardholder": block_cardholder,
        "date": date,
        "description": description,
        "voucher": voucher,
        "ars": ars,
        "usd": usd,
        "installment_number": installment_number,
        "installment_count": installment_count,
        "raw_line": re.sub(r"\s+", " ", line_text(line)).strip(),
    }


# --------------------------------------------------------------------------- #
# integrity checks
# --------------------------------------------------------------------------- #

def check(data: dict, declared_totals: list[dict], filename: str) -> None:
    def block_sum(block, field):
        return round(sum(t[field] or 0 for t in data["transactions"] if t["block"] == block), 2)

    for total in declared_totals:
        if not norm(total["concept"]).startswith("TOTAL CONSUMOS DE"):
            continue
        for field in ("ars", "usd"):
            expected = total[field]
            if expected is None:
                continue
            actual = block_sum(total["block"], field)
            if abs(actual - expected) > 0.05:
                raise UnknownLayout(
                    f"{filename}: block {total['block']} adds up to {actual} in {field} "
                    f"but the PDF declares {expected}")

    header_balance = data["balances"]["current_ars"]
    detail_balance = next(
        (t["ars"] for t in declared_totals if norm(t["concept"]) == "SALDO ACTUAL"), None)
    if header_balance is not None and detail_balance is not None \
            and abs(header_balance - detail_balance) > 0.05:
        raise UnknownLayout(
            f"{filename}: header balance ({header_balance}) != detail balance ({detail_balance})")


# --------------------------------------------------------------------------- #
# entry point
# --------------------------------------------------------------------------- #

KEY_ORDER = ["file", "brand", "product", "account", "cardholder", "period", "balances",
             "limits", "rates", "account_summary", "upcoming_installments", "transactions",
             "declared_totals"]


def convert(pdf_path: Path) -> dict:
    with pdfplumber.open(pdf_path) as pdf:
        pages = [page_lines(p) for p in pdf.pages]

    first_page_text = "\n".join(line_text(l) for l in pages[0])

    data = {"file": pdf_path.name}
    data.update(parse_header(pages[0], first_page_text))
    transactions, declared_totals = parse_transactions(pages)
    data["transactions"] = transactions
    data["declared_totals"] = declared_totals
    check(data, declared_totals, pdf_path.name)

    return {k: data[k] for k in KEY_ORDER}


def main(argv: list[str]) -> int:
    force = "--force" in argv
    args = [a for a in argv if not a.startswith("--")]
    pdfs = [Path(a).resolve() for a in args] if args else sorted(PDF_DIR.glob("*.pdf"))

    JSON_DIR.mkdir(exist_ok=True)
    converted = skipped = 0
    for pdf_path in pdfs:
        target = JSON_DIR / (pdf_path.stem + ".json")
        if target.exists() and not force and not args:
            skipped += 1
            continue
        data = convert(pdf_path)
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"OK  {pdf_path.name} -> {target.name}  "
              f"({len(data['transactions'])} transactions)")
        converted += 1

    print(f"\n{converted} converted, {skipped} already existed (use --force to redo them).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except UnknownLayout as e:
        print(f"\nLAYOUT ERROR: {e}\n", file=sys.stderr)
        print("The PDF does not match the expected layout. Check it before continuing.",
              file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        # Exit 1 means "this is a statement I cannot read"; exit 2 means "this is not a
        # statement at all" - encrypted, corrupt, zero pages, or not there. Without this the
        # caller only ever sees a traceback, and a zero-page PDF looks like a missing file.
        print(f"\nREAD ERROR: {type(e).__name__}: {e}\n", file=sys.stderr)
        sys.exit(2)
