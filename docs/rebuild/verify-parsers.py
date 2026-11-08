#!/usr/bin/env python3
"""Read synthetic PDFs only; compare full extraction against independently fixed JSON."""
import json
from pathlib import Path
import sys
import tempfile
import shutil

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[1] / "scripts"))
from pdf_to_json import convert, UnknownLayout

checks = []
for brand in ["visa", "mastercard", "mercadopago"]:
    expected = json.loads((ROOT / "fixtures" / f"{brand}.expected.json").read_text())
    actual = convert(ROOT / "fixtures/pdf" / expected["file"])
    assert actual == expected, f"Full extraction differs for {brand}"
    checks.append(f"parser-{brand}-complete-envelope")

try:
    convert(ROOT / "fixtures/pdf/unsupported-layout.pdf")
    raise AssertionError("Unsupported layout was accepted")
except UnknownLayout:
    checks.append("unsupported-layout-fails-before-admission")

with tempfile.TemporaryDirectory(prefix="tarjetas-rebuild-parser-") as tmp:
    renamed = Path(tmp) / "mercadopago_without_year.pdf"
    shutil.copyfile(ROOT / "fixtures/pdf/synthetic_mercadopago_2026_02.pdf", renamed)
    try:
        convert(renamed)
        raise AssertionError("Mercado Pago filename without year was accepted")
    except UnknownLayout as error:
        assert "filename must include one" in str(error)
        checks.append("mercadopago-filename-year-required")

print(json.dumps({"passed": len(checks), "checks": checks}, indent=2))
